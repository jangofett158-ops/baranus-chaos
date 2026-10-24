import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {MinecraftBridge, sanitizeDonor, donorToken} from '../lib/minecraft.mjs';
import {rconSend} from '../lib/rcon.mjs';

const connection = {host: '127.0.0.1', port: 25575, password: 'secret'};

test('ник зрителя очищается и передаётся в base64url', () => {
  assert.equal(sanitizeDonor('§cВася <script> ;op me'), 'cВася script op me');
  assert.equal(sanitizeDonor('   '), 'Зритель');
  assert.equal(Buffer.from(donorToken('Аня 2'), 'base64url').toString('utf8'), 'Аня 2');
  assert.match(donorToken('Очень длинное имя зрителя для проверки'), /^[A-Za-z0-9_-]+$/);
});

test('trigger отправляет строгую команду и требует подтверждения мода', async () => {
  const sent = [];
  const bridge = new MinecraftBridge({send: async ({command}) => { sent.push(command); return `BaranusChaos:OK ${command.split(' ')[2]} Streamer`; }});
  await bridge.trigger(connection, 'zombie', 'Streamer', 'Вася');
  assert.equal(sent[0], `baranuschaos trigger zombie Streamer ${donorToken('Вася')} 0 0 0`);
  await bridge.trigger(connection, 'speed', '@a', 'Вася', {params: {seconds: 60, level: 3}});
  assert.equal(sent[1], `baranuschaos trigger speed @a ${donorToken('Вася')} 0 60 3`);
  await assert.rejects(() => bridge.trigger(connection, 'random', 'Streamer', 'x'), /Неизвестный ивент/);
  await assert.rejects(() => bridge.trigger(connection, 'zombie', 'Bad Name', 'x'), /ник/);
});

test('понятные ошибки вместо сырых ответов RCON', async () => {
  const replying = text => new MinecraftBridge({send: async () => text});
  await assert.rejects(() => replying('BaranusChaos:PAUSED').trigger(connection, 'pig', 'Steve', 'x'), /паузе/);
  await assert.rejects(() => replying('No player was found').trigger(connection, 'pig', 'Steve', 'x'), /не в сети/);
  await assert.rejects(() => replying('BaranusChaos:ERROR peaceful').trigger(connection, 'zombie', 'Steve', 'x'), /Мирная/);
  await assert.rejects(() => replying('Unknown or incomplete command, see below for error').trigger(connection, 'pig', 'Steve', 'x'), /нет мода/);
  await assert.rejects(() => new MinecraftBridge({send: async () => ''}).trigger({...connection, password: ''}, 'pig', 'Steve', 'x'), /пароль/);
});

test('своё событие: команда в base64url и понятная ошибка от Minecraft', async () => {
  const sent = [];
  const ok = new MinecraftBridge({send: async ({command}) => { sent.push(command); return 'BaranusChaos:OK custom Steve'; }});
  await ok.custom(connection, 'Steve', 'Аня', 'Салют', ['say привет {donor}']);
  const [, action, player, label, , command] = sent[0].split(' ');
  assert.equal(action, 'custom');
  assert.equal(player, 'Steve');
  assert.equal(Buffer.from(label, 'base64url').toString(), 'Салют');
  assert.equal(Buffer.from(command, 'base64url').toString(), 'say привет {donor}');
  const bad = new MinecraftBridge({send: async () => 'BaranusChaos:ERROR command Unknown or incomplete command, see below for error'});
  await assert.rejects(() => bad.custom(connection, 'Steve', 'x', 'y', ['sya hi']), /не выполнилась: Unknown/);
});

test('скрипт выполняет получатель или любой игрок (@r); первый донат - учёт в моде', async () => {
  const sent = [];
  const bridge = new MinecraftBridge({send: async ({command}) => {
    sent.push(command);
    if (command.startsWith('baranuschaos first')) return command.endsWith(' done') ? 'BaranusChaos:FIRST done' : 'BaranusChaos:FIRST yes';
    return 'BaranusChaos:OK custom 1';
  }});
  await bridge.custom(connection, '@r', 'Аня', 'Салют', ['say {player@a}']);
  assert.equal(sent[0].split(' ')[2], '@r');
  await assert.rejects(() => bridge.custom(connection, '', 'Аня', 'x', ['say {player}']), /ник ещё не определён/);
  assert.equal(await bridge.first(connection, 'c_0000beef'), true);
  await bridge.first(connection, 'c_0000beef', 'done');
  assert.deepEqual(sent.slice(-2), ['baranuschaos first c_0000beef', 'baranuschaos first c_0000beef done']);
  const old = new MinecraftBridge({send: async () => 'Unknown or incomplete command, see below for error'});
  await assert.rejects(() => old.first(connection, 'zombie'), /нет мода Baranus Chaos/);
});

test('статус мода: версия, пауза и игроки', async () => {
  const bridge = new MinecraftBridge({send: async () => 'BaranusChaos:STATUS 1.0.0 1 Steve,Alex'});
  assert.deepEqual(await bridge.status(connection), {version: '1.0.0', paused: true, players: ['Steve', 'Alex'], revision: 0, remote: false, me: ''});
  const fresh = new MinecraftBridge({send: async () => 'BaranusChaos:STATUS 1.5.6 0 Steve 7 1'});
  assert.deepEqual(await fresh.status(connection), {version: '1.5.6', paused: false, players: ['Steve'], revision: 7, remote: true, me: ''});
  const mine = new MinecraftBridge({send: async () => 'BaranusChaos:STATUS 1.5.6 0 Steve,Alex 7 1 Alex'});
  assert.equal((await mine.status(connection)).me, 'Alex', 'ник своего стримера — от мода');
  const empty = new MinecraftBridge({send: async () => 'BaranusChaos:STATUS 1.0.0 0 -'});
  assert.deepEqual((await empty.status(connection)).players, []);
});

function packet(id, type, text = '') {
  const body = Buffer.from(text, 'utf8');
  const result = Buffer.alloc(14 + body.length);
  result.writeInt32LE(10 + body.length, 0); result.writeInt32LE(id, 4); result.writeInt32LE(type, 8);
  body.copy(result, 12);
  return result;
}

test('настоящий TCP-протокол RCON: авторизация, команда, неверный пароль', async () => {
  const received = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const length = buffer.readInt32LE(0);
        const body = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        const id = body.readInt32LE(0), type = body.readInt32LE(4), text = body.subarray(8, -2).toString('utf8');
        if (type === 3) socket.write(packet(text === 'secret' ? id : -1, 2));
        else { received.push(text); socket.write(packet(id, 0, 'BaranusChaos:STATUS 1.0.0 0 Steve')); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const status = await new MinecraftBridge({send: rconSend}).status({host: '127.0.0.1', port, password: 'secret'});
    assert.deepEqual(status.players, ['Steve']);
    assert.deepEqual(received, ['baranuschaos status']);
    await assert.rejects(() => rconSend({host: '127.0.0.1', port, password: 'wrong', command: 'x'}), /Неверный пароль/);
  } finally {
    server.close();
  }
});
