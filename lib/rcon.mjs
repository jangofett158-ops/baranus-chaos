import net from 'node:net';

const AUTH_ID = 101, COMMAND_ID = 102;

function packet(id, type, payload = '') {
  const body = Buffer.from(payload, 'utf8');
  const result = Buffer.alloc(14 + body.length);
  result.writeInt32LE(10 + body.length, 0);
  result.writeInt32LE(id, 4);
  result.writeInt32LE(type, 8);
  body.copy(result, 12);
  return result;
}

/** Одна команда по протоколу Source RCON (Minecraft). Без сторонних библиотек. */
export async function rconSend(options) {
  try {
    return await rconOnce(options);
  } catch (error) {
    // Мост мода 1.4.0 на выделенном сервере мог слушать только ::1 (Java там предпочитает IPv6).
    if (options.host === '127.0.0.1' && error.code === 'ECONNREFUSED') return rconOnce({...options, host: '::1'});
    throw error;
  }
}

function rconOnce({host, port, password, command, timeoutMs = 5000}) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), authed = false, settled = false;
    const socket = net.createConnection({host, port});
    socket.setTimeout(timeoutMs);
    const done = (error, reply) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(reply);
    };
    socket.on('connect', () => socket.write(packet(AUTH_ID, 3, password)));
    socket.on('timeout', () => done(new Error('Сервер Minecraft не отвечает (RCON).')));
    socket.on('error', error => done(error.code === 'ECONNREFUSED'
      ? Object.assign(new Error('Сервер Minecraft недоступен: RCON не принимает подключения.'), {code: 'ECONNREFUSED'})
      : error));
    socket.on('close', () => done(new Error('RCON закрыл соединение.')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || length > 1024 * 1024) return done(new Error('Некорректный ответ RCON.'));
        if (buffer.length < length + 4) break;
        const body = buffer.subarray(4, length + 4);
        buffer = buffer.subarray(length + 4);
        const id = body.readInt32LE(0), type = body.readInt32LE(4);
        const text = body.subarray(8, body.length - 2).toString('utf8');
        if (!authed && type === 2) {
          if (id === -1) return done(new Error('Неверный пароль RCON.'));
          if (id === AUTH_ID) { authed = true; socket.write(packet(COMMAND_ID, 2, command)); }
        } else if (authed && type === 0 && id === COMMAND_ID) {
          return done(null, text);
        }
      }
    });
  });
}
