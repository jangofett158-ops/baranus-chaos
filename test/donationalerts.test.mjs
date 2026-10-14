import test from 'node:test';
import assert from 'node:assert/strict';
import {OAuthFlow, DonationStream, DonationPoller, HttpError, closeReason, DEFAULT_CLIENT_ID, REDIRECT_URI, SCOPES} from '../lib/donationalerts.mjs';

test('запасной опрос: старые донаты пропускаются, новые выполняются по одному разу', async () => {
  let list = [{id: 10, amount: 20, currency: 'RUB'}, {id: 9, amount: 50, currency: 'RUB'}];
  const seen = [], statuses = [];
  const poller = new DonationPoller({getToken: async () => 't', api: async path => { assert.equal(path, '/alerts/donations'); return {data: list}; },
    onDonation: async item => seen.push(item.id), onStatus: status => statuses.push(status.state), intervalMs: 10});
  poller.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  list = [{id: 12, amount: 20, currency: 'RUB'}, {id: 11, amount: 15, currency: 'RUB'}, ...list];
  await new Promise(resolve => setTimeout(resolve, 40));
  poller.stop();
  assert.deepEqual(seen, [11, 12]);
  assert.ok(statuses.includes('ok'));
});

test('опрос без разрешения просит войти заново', async () => {
  const statuses = [];
  const poller = new DonationPoller({getToken: async () => 't', onDonation: async () => {}, onStatus: status => statuses.push(status),
    api: async () => { throw new HttpError(401, 'DonationAlerts: HTTP 401 {"message":"Invalid scope(s) provided."}'); }});
  poller.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  poller.stop();
  assert.equal(statuses[0].state, 'scope');
  assert.match(SCOPES, /oauth-donation-index/);
});

test('причина закрытия WebSocket понятным текстом', () => {
  assert.equal(closeReason({code: 3004, reason: '{"reason":"internal server error","reconnect":true}'}), 'код 3004: internal server error');
  assert.equal(closeReason({code: 3002, reason: ''}), 'код 3002: неверный токен соединения');
});

class FakeSocket {
  constructor() { this.handlers = new Map(); this.sent = []; this.closed = false; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  emit(name, value = {}) { this.handlers.get(name)?.(value); }
  send(value) { this.sent.push(value); }
  close() { this.closed = true; }
}

function setup(overrides = {}) {
  const sockets = [], statuses = [], donations = [];
  const api = async path => path === '/user/oauth'
    ? {data: {id: 41, name: 'Baranus', code: 'baranus', socket_connection_token: 'ws-token'}}
    : {channels: [{channel: '$alerts:donation_41', token: 'sub-token'}]};
  const stream = new DonationStream({
    getToken: async () => 'token', api, onStatus: status => statuses.push(status), onDonation: async value => donations.push(value),
    websocketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; }, ...overrides
  });
  return {stream, sockets, statuses, donations};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('вход в один клик: implicit grant без client secret', () => {
  const flow = new OAuthFlow();
  const url = new URL(flow.begin());
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('client_id'), DEFAULT_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.has('client_secret'), false);
  const state = url.searchParams.get('state');
  assert.throws(() => flow.consume({state: 'чужой', access_token: 'x'.repeat(40)}), /устарела/);
  flow.begin();
  const fresh = new URL(flow.begin()).searchParams.get('state');
  const result = flow.consume({state: fresh, access_token: 'x'.repeat(40), expires_in: '3600'});
  assert.equal(result.token, 'x'.repeat(40));
  assert.ok(result.expiresAt > Date.now());
  assert.throws(() => flow.consume({state: fresh, access_token: 'x'.repeat(40)}), /устарела/, 'state одноразовый');
  assert.notEqual(state, fresh);
});

test('полный цикл Centrifugo v2: подключение, подписка и донат-публикация', async () => {
  const {stream, sockets, statuses, donations} = setup();
  stream.start();
  await tick();
  const ws = sockets[0];
  ws.emit('open');
  assert.deepEqual(JSON.parse(ws.sent[0]), {params: {token: 'ws-token'}, id: 1});
  ws.emit('message', {data: JSON.stringify({id: 1, result: {client: 'client-uuid', version: '2.2.1'}})});
  await tick();
  assert.deepEqual(JSON.parse(ws.sent[1]), {params: {channel: '$alerts:donation_41', token: 'sub-token'}, method: 1, id: 2});
  ws.emit('message', {data: JSON.stringify({id: 2, result: {}})});
  assert.equal(statuses.at(-1).state, 'online');
  // Join-уведомление (type 1) — не донат.
  ws.emit('message', {data: JSON.stringify({result: {type: 1, channel: '$alerts:donation_41', data: {info: {user: '1'}}}})});
  // Публикация доната: без поля method, как присылает DonationAlerts.
  ws.emit('message', {data: JSON.stringify({result: {channel: '$alerts:donation_41', data: {seq: 1, data: {id: 900, amount: 20, currency: 'RUB', username: 'Аня'}}}})});
  await tick();
  assert.equal(donations.length, 1);
  assert.equal(donations[0].id, 900);
  stream.stop();
  assert.equal(ws.closed, true);
});

test('heartbeat {} получает ответ, чужой канал игнорируется', async () => {
  const {stream, sockets, donations} = setup();
  stream.start();
  await tick();
  const ws = sockets[0];
  ws.emit('message', {data: '{}'});
  assert.equal(ws.sent.at(-1), '{}');
  ws.emit('message', {data: JSON.stringify({result: {channel: '$alerts:donation_999', data: {data: {id: 1, amount: 20, currency: 'RUB'}}}})});
  await tick();
  assert.equal(donations.length, 0);
  stream.stop();
});

test('истёкший токен останавливает переподключения и просит войти снова', async () => {
  const {stream, statuses} = setup({getToken: async () => { throw new HttpError(401, 'expired'); }});
  stream.start();
  await tick();
  assert.equal(statuses.at(-1).state, 'auth');
  assert.equal(stream.running, false);
});
