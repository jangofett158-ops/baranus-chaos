import {MOD_CODES} from './catalog.mjs';
import {rconSend} from './rcon.mjs';
import {PLAYER_RE} from './settings.mjs';

export const MOD_VERSION = '1.3.0';

/** Ник зрителя для игры: только буквы, цифры, пробел и _.- (никакого форматирования и команд). */
export function sanitizeDonor(name) {
  return String(name ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 24) || 'Зритель';
}

/** Ник передаётся в base64url: кириллица и пробелы не зависят от кодировки RCON и разбора команд. */
export function donorToken(name) {
  return Buffer.from(sanitizeDonor(name), 'utf8').toString('base64url');
}

const ERRORS = {
  peaceful: 'Мирная сложность: враждебные мобы не появляются.',
  spectator: 'Игрок в режиме наблюдателя.',
  dead: 'Игрок сейчас мёртв.',
  'no-space': 'Рядом с игроком нет места для появления.',
  'bad-command': 'Команда своего события повреждена или слишком длинная.',
  failed: 'Мод не смог выполнить событие.'
};

function explain(reply, player) {
  if (reply.includes('BaranusChaos:PAUSED')) return 'Хаос на паузе в игре (клавиша K).';
  const code = reply.match(/BaranusChaos:ERROR (\S+)/)?.[1];
  if (code) return ERRORS[code] || `Мод вернул ошибку: ${code}.`;
  if (/No player was found/i.test(reply)) return `Игрок ${player} не в сети.`;
  if (/Unknown or incomplete command|Incorrect argument/i.test(reply)) return `На сервере нет мода Baranus Chaos ${MOD_VERSION}.`;
  return 'Мод не подтвердил событие: ' + reply.slice(0, 160);
}

export class MinecraftBridge {
  constructor({send = rconSend} = {}) { this.send = send; }

  async run(connection, command) {
    if (!connection.password) throw new Error('Введите пароль RCON во вкладке «Подключения».');
    return String(await this.send({host: connection.host, port: connection.port, password: connection.password, command}));
  }

  async status(connection) {
    const reply = await this.run(connection, 'baranuschaos status');
    const match = reply.match(/BaranusChaos:STATUS (\S+) ([01]) (\S+)/);
    if (!match) throw new Error(explain(reply, ''));
    const players = match[3] === '-' ? [] : match[3].split(',').filter(name => PLAYER_RE.test(name));
    return {version: match[1], paused: match[2] === '1', players};
  }

  async trigger(connection, code, player, donor, {test = false} = {}) {
    if (!MOD_CODES.includes(code)) throw new Error('Неизвестное событие.');
    if (!PLAYER_RE.test(player || '')) throw new Error('Укажите ник игрока во вкладке «Подключения».');
    const command = `baranuschaos ${test ? 'test' : 'trigger'} ${code} ${player} ${donorToken(donor)}`;
    const reply = await this.run(connection, command);
    if (!reply.includes(`BaranusChaos:OK ${code} `)) throw new Error(explain(reply, player));
    return {command};
  }

  /** Своё событие: команды Minecraft выполняет мод от имени игрока; подпись показывается один раз. */
  async custom(connection, player, donor, label, commands, {test = false} = {}) {
    if (!PLAYER_RE.test(player || '')) throw new Error('Укажите ник игрока во вкладке «Подключения».');
    const b64 = text => Buffer.from(String(text), 'utf8').toString('base64url');
    for (const [index, command] of commands.entries()) {
      const title = index === 0 && label ? b64(label) : '-';
      const reply = await this.run(connection, `baranuschaos ${test ? 'customtest' : 'custom'} ${player} ${title} ${donorToken(donor)} ${b64(command)}`);
      if (!reply.includes('BaranusChaos:OK custom ')) {
        const details = reply.match(/BaranusChaos:ERROR command (.*)/)?.[1];
        throw new Error(details ? `Команда «${command.slice(0, 60)}» не выполнилась: ${details === '-' ? 'без пояснения' : details.slice(0, 160)}` : explain(reply, player));
      }
    }
  }

  async cleanup(connection, player) {
    if (!PLAYER_RE.test(player || '')) throw new Error('Укажите ник игрока во вкладке «Подключения».');
    const reply = await this.run(connection, `baranuschaos cleanup ${player}`);
    const match = reply.match(/BaranusChaos:CLEANED (\d+)/);
    if (!match) throw new Error(explain(reply, player));
    return Number(match[1]);
  }

  async setPaused(connection, paused) {
    const reply = await this.run(connection, `baranuschaos ${paused ? 'pause' : 'resume'}`);
    if (!reply.includes(`BaranusChaos:PAUSE ${paused ? 1 : 0}`)) throw new Error(explain(reply, ''));
  }
}
