import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../lib/app.mjs';

const publicDir = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function fakeMinecraft({delayMs = 0} = {}) {
  const log = [];
  let active = 0, maxActive = 0;
  const send = async ({command}) => {
    log.push(command);
    if (command === 'baranuschaos status') return 'BaranusChaos:STATUS 1.2.0 0 Streamer';
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    active--;
    const [, action, code, player] = command.split(' ');
    if (action === 'custom' || action === 'customtest') return `BaranusChaos:OK custom ${code}`;
    return `BaranusChaos:OK ${code} ${player}`;
  };
  return {send, log, get maxActive() { return maxActive; }};
}

async function start(options = {}) {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-app-'));
  const app = createApp({dataDir, publicDir, port: 0, statusIntervalMs: 60_000, ratesIntervalMs: 0, ...options});
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  const post = async (route, body = {}, headers = {}) => {
    const response = await fetch(base + route, {method: 'POST', headers: {'content-type': 'application/json', 'x-baranus': '1', ...headers}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  };
  const get = async route => (await fetch(base + route)).json();
  return {app, dataDir, port, base, post, get, async stop() { await app.close(); fs.rmSync(dataDir, {recursive: true, force: true}); }};
}

async function connected(minecraft, options = {}) {
  const ctx = await start({send: minecraft.send, ...options});
  try {
    const saved = await ctx.post('/api/minecraft', {mode: 'rcon', host: '127.0.0.1', port: 25575, password: 'rcon-secret', player: 'Streamer', simulate: false});
    assert.equal(saved.status, 200);
    assert.equal(saved.body.mc.state, 'online', saved.body.mc.message);
    return ctx;
  } catch (error) {
    await ctx.stop();
    throw error;
  }
}

const donation = (id, amount, extra = {}) => ({seq: id, data: {id, amount, currency: 'RUB', username: 'Аня', message: '', ...extra}});

test('донаты выполняются сразу и параллельно — без очереди', async () => {
  const minecraft = fakeMinecraft({delayMs: 120});
  const ctx = await connected(minecraft);
  try {
    const started = Date.now();
    await Promise.all([ctx.app.onDonation(donation(1, 20)), ctx.app.onDonation(donation(2, 199)), ctx.app.onDonation(donation(3, 15))]);
    assert.ok(Date.now() - started < 300, 'три доната не ждут друг друга');
    assert.equal(minecraft.maxActive, 3);
    const {history} = await ctx.get('/api/state');
    assert.deepEqual(history.filter(item => item.state === 'done').map(item => item.code).sort(), ['giantzombie', 'pig', 'zombie']);
    assert.ok(minecraft.log.some(command => command.startsWith('baranuschaos trigger giantzombie Streamer ')));
  } finally { await ctx.stop(); }
});

test('повторный донат с тем же ID и сумма без события', async () => {
  const minecraft = fakeMinecraft();
  const ctx = await connected(minecraft);
  try {
    await ctx.app.onDonation(donation(10, 20));
    await ctx.app.onDonation(donation(10, 20));
    await ctx.app.onDonation(donation(11, 21));
    const {history} = await ctx.get('/api/state');
    assert.equal(history.filter(item => item.donationId === '10').length, 1);
    assert.equal(history.find(item => item.donationId === '11').state, 'ignored');
    assert.equal(minecraft.log.filter(command => command.includes('trigger')).length, 1);
  } finally { await ctx.stop(); }
});

test('пауза: донат пропускается, потом его можно запустить вручную один раз', async () => {
  const minecraft = fakeMinecraft();
  const ctx = await connected(minecraft);
  try {
    assert.equal((await ctx.post('/api/settings', {paused: true})).body.settings.paused, true);
    await ctx.app.onDonation(donation(20, 60));
    let {history} = await ctx.get('/api/state');
    const skipped = history.find(item => item.donationId === '20');
    assert.equal(skipped.state, 'skipped');
    assert.equal(minecraft.log.some(command => command.includes('trigger')), false);
    const replay = await ctx.post('/api/replay', {id: skipped.id});
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.code, 'creeper');
    assert.equal((await ctx.post('/api/replay', {id: skipped.id})).status, 400);
    ({history} = await ctx.get('/api/state'));
    assert.equal(history[0].kind, 'replay');
  } finally { await ctx.stop(); }
});

test('тест события обходит паузу в игре, тестовый донат идёт как настоящий', async () => {
  const minecraft = fakeMinecraft();
  const ctx = await connected(minecraft);
  try {
    assert.equal((await ctx.post('/api/test/effect', {code: 'wolf'})).body.ok, true);
    assert.ok(minecraft.log.includes(`baranuschaos test wolf Streamer ${Buffer.from('Тест').toString('base64url')}`));
    const result = await ctx.post('/api/test/donation', {amount: 79, username: 'Петя'});
    assert.equal(result.body.code, 'wolf');
    assert.ok(minecraft.log.some(command => command.startsWith('baranuschaos trigger wolf Streamer')));
    assert.equal((await ctx.post('/api/test/donation', {amount: 3})).status, 422);
  } finally { await ctx.stop(); }
});

test('создание своего события в интерфейсе и запуск его донатом', async () => {
  const minecraft = fakeMinecraft();
  const ctx = await connected(minecraft);
  try {
    const created = await ctx.post('/api/events/save', {name: 'Вечеринка', icon: '🎉', desc: 'Салют', price: 333,
      commands: 'say {donor} устроил вечеринку\nsummon minecraft:firework_rocket ~ ~1 ~'});
    assert.equal(created.status, 200);
    const code = created.body.savedCode;
    assert.match(code, /^c_[a-z0-9]+$/);
    assert.equal(created.body.catalog.find(item => item.code === code).name, 'Вечеринка');
    await ctx.app.onDonation(donation(60, 333, {username: 'Аня'}));
    const customCalls = minecraft.log.filter(command => command.startsWith('baranuschaos custom Streamer '));
    assert.equal(customCalls.length, 2);
    const [, , , label, donor, command] = customCalls[0].split(' ');
    assert.equal(Buffer.from(label, 'base64url').toString(), 'Вечеринка');
    assert.equal(Buffer.from(donor, 'base64url').toString(), 'Аня');
    assert.equal(Buffer.from(command, 'base64url').toString(), 'say {donor} устроил вечеринку');
    assert.equal(customCalls[1].split(' ')[3], '-', 'подпись показывается один раз');
    const {history} = await ctx.get('/api/state');
    assert.equal(history.find(item => item.donationId === '60').state, 'done');
    // Редактирование и удаление
    const edited = await ctx.post('/api/events/save', {code, name: 'Вечеринка 2', icon: '🎉', price: 334, commands: 'say ok'});
    assert.equal(edited.body.catalog.find(item => item.code === code).price, 334);
    const builtIn = await ctx.post('/api/events/save', {code: 'zombie', name: 'Мертвяк', icon: '💀', price: 21});
    assert.equal(builtIn.body.catalog.find(item => item.code === 'zombie').name, 'Мертвяк');
    const deleted = await ctx.post('/api/events/delete', {code});
    assert.equal(deleted.body.catalog.some(item => item.code === code), false);
    assert.equal((await ctx.post('/api/events/save', {code: 'c_nope!', name: 'x', icon: '✨', price: 5, commands: 'say'})).status, 400);
  } finally { await ctx.stop(); }
});

test('зритель из другой страны: курс подтягивается сам, донат в долларах запускает событие', async () => {
  const minecraft = fakeMinecraft();
  const requested = [];
  const fetchImpl = async url => {
    requested.push(String(url));
    return {ok: true, status: 200, json: async () => ({result: 'success', time_last_update_unix: 1792022551, rates: {RUB: 1, USD: 1 / 10}})};
  };
  const ctx = await connected(minecraft, {fetchImpl});
  try {
    const saved = await ctx.post('/api/settings', {extraCurrencies: {USD: {}}});
    assert.match(requested[0], /open\.er-api\.com\/v6\/latest\/RUB$/);
    assert.equal(saved.body.settings.extraCurrencies.USD.rate, 10);
    assert.equal(saved.body.rates.state, 'ok');
    assert.equal(saved.body.catalog.find(item => item.code === 'giantzombie').prices.USD, 20); // 199 ₽ / 10 = 19,9 → 20 $
    await ctx.app.onDonation({id: 70, amount: 20, currency: 'USD', username: 'John'});
    const {history} = await ctx.get('/api/state');
    const entry = history.find(item => item.donationId === '70');
    assert.equal(entry.state, 'done');
    assert.equal(entry.code, 'giantzombie');
    assert.equal(entry.currency, 'USD');
    const test = await ctx.post('/api/test/donation', {amount: 20, currency: 'USD'});
    assert.equal(test.body.code, 'giantzombie');
  } finally { await ctx.stop(); }
});

test('ошибка мода видна в ленте, донат можно повторить', async () => {
  let fail = true;
  const send = async ({command}) => command === 'baranuschaos status' ? 'BaranusChaos:STATUS 1.2.0 0 Streamer'
    : fail ? 'No player was found' : `BaranusChaos:OK ${command.split(' ')[2]} Streamer`;
  const ctx = await connected({send});
  try {
    await ctx.app.onDonation(donation(30, 20));
    const failed = (await ctx.get('/api/state')).history.find(item => item.donationId === '30');
    assert.equal(failed.state, 'failed');
    assert.match(failed.reason, /не в сети/);
    fail = false;
    assert.equal((await ctx.post('/api/replay', {id: failed.id})).body.ok, true);
  } finally { await ctx.stop(); }
});

test('защита локального API и секреты не уходят в интерфейс', async () => {
  const ctx = await connected(fakeMinecraft());
  try {
    assert.equal((await ctx.post('/api/settings', {paused: true}, {'x-baranus': ''})).status, 400);
    assert.equal((await ctx.post('/api/settings', {paused: true}, {origin: 'https://evil.example'})).status, 403);
    const forged = await new Promise(resolve => http.get({host: '127.0.0.1', port: ctx.port, path: '/api/state', headers: {host: 'evil.example'}}, resolve));
    assert.equal(forged.statusCode, 403);
    forged.resume();
    const state = JSON.stringify(await ctx.get('/api/state'));
    assert.equal(state.includes('rcon-secret'), false);
    assert.equal(JSON.parse(state).settings.minecraft.hasPassword, true);
    const page = await fetch(ctx.base + '/');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  } finally { await ctx.stop(); }
});

test('вход DonationAlerts: ссылка → callback → подключение к потоку донатов', async () => {
  const sockets = [];
  const fetchImpl = async () => ({ok: true, json: async () => ({data: {id: 5, name: 'Baranus', code: 'baranus', socket_connection_token: 'ws'}})});
  const ctx = await start({send: fakeMinecraft().send, fetchImpl, websocketFactory: () => {
    const socket = {addEventListener() {}, send() {}, close() {}};
    sockets.push(socket);
    return socket;
  }});
  try {
    const {url} = (await ctx.post('/api/da/login')).body;
    const state = new URL(url).searchParams.get('state');
    assert.equal((await ctx.post('/api/da/session', {state: 'wrong', access_token: 't'.repeat(30)})).status, 400);
    const {url: url2} = (await ctx.post('/api/da/login')).body;
    const ok = await ctx.post('/api/da/session', {state: new URL(url2).searchParams.get('state'), access_token: 't'.repeat(30), expires_in: '3600'});
    assert.equal(ok.status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    const snapshot = await ctx.get('/api/state');
    assert.equal(snapshot.da.profile.name, 'Baranus');
    assert.equal(sockets.length, 1);
    assert.notEqual(state, null);
    assert.equal(JSON.stringify(snapshot).includes('t'.repeat(30)), false);
  } finally { await ctx.stop(); }
});

const respond = (status, body) => ({ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body)});
const fakeSocket = () => ({addEventListener() {}, send() {}, close() {}});

test('локальный мир: без пароля, мост 127.0.0.1:25585, единственный игрок выбирается сам', async () => {
  const calls = [];
  const send = async ({host, port, password, command}) => {
    calls.push({host, port, password, command});
    if (command === 'baranuschaos status') return 'BaranusChaos:STATUS 1.2.0 0 Streamer';
    return `BaranusChaos:OK ${command.split(' ')[2]} Streamer`;
  };
  const ctx = await start({send});
  try {
    const saved = await ctx.post('/api/minecraft', {mode: 'local', player: '', simulate: false});
    assert.equal(saved.body.mc.state, 'online');
    assert.equal(saved.body.mc.target, 'Streamer');
    await ctx.app.onDonation(donation(50, 20));
    const trigger = calls.find(call => call.command.startsWith('baranuschaos trigger'));
    assert.equal(trigger.port, 25585);
    assert.equal(trigger.host, '127.0.0.1');
    assert.match(trigger.command, /^baranuschaos trigger zombie Streamer /);
  } finally { await ctx.stop(); }
});

test('локальный мир не запущен — понятное сообщение', async () => {
  const ctx = await start({send: async () => { throw new Error('Сервер Minecraft недоступен: RCON не принимает подключения.'); }});
  try {
    const saved = await ctx.post('/api/minecraft', {mode: 'local', player: 'Streamer', simulate: false});
    assert.equal(saved.body.mc.state, 'error');
    assert.match(saved.body.mc.message, /Мир не запущен/);
  } finally { await ctx.stop(); }
});

test('вход DonationAlerts с Client Secret: код меняется на токен', async () => {
  const tokenRequests = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/oauth/token')) { tokenRequests.push(Object.fromEntries(new URLSearchParams(options.body))); return respond(200, {access_token: 'a'.repeat(40), refresh_token: 'r'.repeat(40), expires_in: 3600}); }
    return respond(200, {data: {id: 5, name: 'Baranus', code: 'baranus', socket_connection_token: 'ws'}});
  };
  const ctx = await start({send: fakeMinecraft().send, fetchImpl, websocketFactory: fakeSocket});
  try {
    const saved = await ctx.post('/api/da/client-id', {clientId: '21941', clientSecret: 'super-secret'});
    assert.equal(saved.body.settings.hasDaSecret, true);
    assert.equal(JSON.stringify(saved.body).includes('super-secret'), false);
    const url = new URL((await ctx.post('/api/da/login')).body.url);
    assert.equal(url.searchParams.get('response_type'), 'code');
    const ok = await ctx.post('/api/da/session', {state: url.searchParams.get('state'), code: 'auth-code-123'});
    assert.equal(ok.status, 200);
    assert.equal(tokenRequests[0].grant_type, 'authorization_code');
    assert.equal(tokenRequests[0].client_secret, 'super-secret');
    assert.equal(tokenRequests[0].code, 'auth-code-123');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await ctx.get('/api/state')).da.profile.name, 'Baranus');
  } finally { await ctx.stop(); }
});

test('ошибка DonationAlerts при входе видна пользователю', async () => {
  const ctx = await start({send: fakeMinecraft().send});
  try {
    const url = new URL((await ctx.post('/api/da/login')).body.url);
    const failed = await ctx.post('/api/da/session', {state: url.searchParams.get('state'), error: 'unsupported_grant_type', error_description: 'Implicit grant disabled'});
    assert.equal(failed.status, 400);
    assert.match(failed.body.error, /unsupported_grant_type.*Implicit grant disabled/);
  } finally { await ctx.stop(); }
});

test('секрет и refresh-токен из 0.4.0 подхватываются, просроченный токен обновляется сам', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-refresh-'));
  const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
  write('settings.json', {daClientId: '21941'}); // настройки 1.0.0 уже есть
  write('connection.json', {DA_CLIENT_ID: '21941', DA_CLIENT_SECRET: 'legacy-secret'});
  write('tokens.json', {access_token: 'old-token-'.repeat(3), refresh_token: 'refresh-1', expires_at: Date.now() + 100000});
  const tokenRequests = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/oauth/token')) { tokenRequests.push(Object.fromEntries(new URLSearchParams(options.body))); return respond(200, {access_token: 'new-token-'.repeat(3), refresh_token: 'refresh-2', expires_in: 3600}); }
    return options.headers.Authorization.includes('new-token') ? respond(200, {data: {id: 5, name: 'Baranus', socket_connection_token: 'ws'}}) : respond(401, {message: 'Unauthenticated.'});
  };
  const ctx = await start({dataDir, send: fakeMinecraft().send, fetchImpl, websocketFactory: fakeSocket});
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(tokenRequests[0]?.grant_type, 'refresh_token');
    assert.equal(tokenRequests[0].client_secret, 'legacy-secret');
    assert.equal(tokenRequests[0].refresh_token, 'refresh-1');
    const state = await ctx.get('/api/state');
    assert.equal(state.da.profile?.name, 'Baranus');
    assert.equal(state.settings.hasDaSecret, true);
    assert.equal(new URL((await ctx.post('/api/da/login')).body.url).searchParams.get('response_type'), 'code');
  } finally { await ctx.stop(); }
});

test('перенос настроек из версии 0.4.0', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-migrate-'));
  const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
  write('connection.json', {MC_RCON_HOST: '10.0.0.5', MC_RCON_PORT: '25580', MC_PLAYER: 'Baranus', MC_RCON_PASSWORD: 'old-pass', DA_CLIENT_ID: '12345', DRY_RUN: 'false'});
  write('config.json', {enabled: true, events: [{code: 'zombie', price: 33, currency: 'RUB', enabled: false}]});
  write('overlay.json', {color: '#123456', duration: 8, position: 'top-right', showAmount: false});
  write('tokens.json', {access_token: 'old-token', expires_at: Date.now() + 100000});
  const ctx = await start({dataDir, send: fakeMinecraft().send, fetchImpl: async () => ({ok: false, status: 500, text: async () => ''}), websocketFactory: () => ({addEventListener() {}, close() {}})});
  try {
    const {settings} = await ctx.get('/api/state');
    assert.deepEqual(settings.minecraft, {mode: 'local', host: '10.0.0.5', port: 25580, player: 'Baranus', simulate: false, hasPassword: true});
    assert.equal(settings.daClientId, '12345');
    assert.deepEqual(settings.events.zombie, {price: 33, enabled: false});
    assert.equal(settings.overlay.position, 'top-right');
  } finally { await ctx.stop(); }
});
