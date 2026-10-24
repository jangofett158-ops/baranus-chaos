import {MOD_CODES} from './catalog.mjs';
import {rconSend} from './rcon.mjs';
import {PLAYER_RE} from './settings.mjs';

export const MOD_VERSION = '1.5.6';

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
  'bad-command': 'Команда своего ивента повреждена или слишком длинная.',
  failed: 'Мод не смог выполнить ивент.'
};

function explain(reply, player) {
  if (reply.includes('BaranusChaos:PAUSED')) return 'Хаос на паузе в игре (клавиша K).';
  const code = reply.match(/BaranusChaos:ERROR (\S+)/)?.[1];
  if (code) return ERRORS[code] || `Мод вернул ошибку: ${code}.`;
  if (/No player was found/i.test(reply)) return `Игрок ${player} не в сети.`;
  if (/Unknown or incomplete command|Incorrect argument/i.test(reply)) return `На сервере нет мода Baranus Chaos ${MOD_VERSION}.`;
  return 'Мод не подтвердил ивент: ' + reply.slice(0, 160);
}

function checkTarget(target) {
  if (target !== '@a' && target !== '@r' && !PLAYER_RE.test(target || '')) throw new Error('Ваш ник ещё не определён: зайдите в мир с модом (на сервере по RCON - впишите ник в «Подключениях»).');
}

export class MinecraftBridge {
  constructor({send = rconSend} = {}) { this.send = send; }

  async run(connection, command) {
    if (!connection.password) throw new Error('Введите пароль RCON во вкладке «Подключения».');
    return String(await this.send({host: connection.host, port: connection.port, password: connection.password, command}));
  }

  async status(connection) {
    const reply = await this.run(connection, 'baranuschaos status');
    const match = reply.match(/BaranusChaos:STATUS (\S+) ([01]) (\S+)(?: (\d+) ([01]))?(?: (\S+))?/);
    if (!match) throw new Error(explain(reply, ''));
    const players = match[3] === '-' ? [] : match[3].split(',').filter(name => PLAYER_RE.test(name));
    // me — ник стримера этого приложения, мод определяет его по подключению (хозяин мира или игра с того же адреса).
    const me = match[6] && PLAYER_RE.test(match[6]) ? match[6] : '';
    return {version: match[1], paused: match[2] === '1', players, revision: Number(match[4] || 0), remote: match[5] === '1', me};
  }

  /** target — ник игрока или @a (все игроки). params — {count, seconds, level}, 0 — по умолчанию мода. */
  async trigger(connection, code, target, donor, {test = false, params = {}} = {}) {
    if (!MOD_CODES.includes(code)) throw new Error('Неизвестный ивент.');
    checkTarget(target);
    const p = ['count', 'seconds', 'level'].map(key => Math.max(0, Math.round(Number(params[key]) || 0)));
    const command = `baranuschaos ${test ? 'test' : 'trigger'} ${code} ${target} ${donorToken(donor)} ${p.join(' ')}`;
    const reply = await this.run(connection, command);
    if (!reply.includes(`BaranusChaos:OK ${code} `)) throw new Error(explain(reply, target));
    return {command};
  }

  /**
   * Скрипт ивента: команды Minecraft выполняет мод от имени игрока player (получателя доната; @r - любого игрока,
   * если получатель неизвестен, а в командах только {player@a}). Мод подставляет {player} - ник этого игрока,
   * {player@a} - @a (все игроки), {donor} - ник зрителя. Подпись показывается один раз.
   */
  async custom(connection, player, donor, label, commands, {test = false} = {}) {
    checkTarget(player);
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

  /**
   * Учёт «первого доната» в мире: check - true, если ивент в этом мире ещё не срабатывал;
   * done - отметить, что сработал; reset - снова «первый раз».
   */
  async first(connection, code, action = 'check') {
    const reply = await this.run(connection, 'baranuschaos first ' + code + (action === 'check' ? '' : ' ' + action));
    const match = reply.match(/BaranusChaos:FIRST (yes|no|done|reset)/);
    if (!match) throw new Error(explain(reply, ''));
    return match[1] === 'yes';
  }

  async cleanup(connection, player) {
    if (!PLAYER_RE.test(player || '')) throw new Error('Укажите ник игрока во вкладке «Подключения».');
    const reply = await this.run(connection, `baranuschaos cleanup ${player}`);
    const match = reply.match(/BaranusChaos:CLEANED (\d+)/);
    if (!match) throw new Error(explain(reply, player));
    return Number(match[1]);
  }

  /** Общая очередь в моде: можно ли запускать событие. 0 — да, иначе сколько ждать (мс). */
  async claim(connection, code, gap, cooldown) {
    const reply = await this.run(connection, `baranuschaos claim ${code} ${gap} ${cooldown}`);
    if (reply.includes('BaranusChaos:CLAIM ok')) return 0;
    const wait = reply.match(/BaranusChaos:CLAIM wait (\d+)/);
    if (wait) return Number(wait[1]);
    throw new Error(explain(reply, ''));
  }

  /** Прочитать общие настройки из мира. data: null — их там ещё нет. */
  async syncGet(connection) {
    const head = (await this.run(connection, 'baranuschaos sync get')).match(/BaranusChaos:SYNC (\d+) (\d+)/);
    if (!head) throw new Error('Мод не отдал общие настройки.');
    const [revision, chunks] = [Number(head[1]), Number(head[2])];
    if (!chunks) return {revision, data: null};
    let encoded = '';
    for (let index = 0; index < chunks; index++) {
      const part = (await this.run(connection, `baranuschaos sync chunk ${index}`)).match(/BaranusChaos:CHUNK \d+ ([A-Za-z0-9_-]+)/);
      if (!part) throw new Error('Общие настройки пришли не полностью.');
      encoded += part[1];
    }
    return {revision, data: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))};
  }

  /**
   * Сохранить общие настройки в мир (частями). Возвращает новую ревизию. expect - ревизия, прочитанная перед записью:
   * если мир с тех пор изменился, мод откажет, и будет ошибка с conflict = true.
   */
  async syncPut(connection, data, expect) {
    const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
    const parts = encoded.match(/.{1,900}/g) || [''];
    const upload = Math.random().toString(36).slice(2, 10);
    const check = Number.isInteger(expect) && expect >= 0 ? ` ${expect}` : '';
    for (const [index, part] of parts.entries()) {
      const reply = await this.run(connection, `baranuschaos sync put ${upload} ${index} ${parts.length} ${part}${check}`);
      const done = reply.match(/BaranusChaos:SYNCED (\d+)/);
      if (done) return Number(done[1]);
      if (reply.includes('BaranusChaos:ERROR conflict')) throw Object.assign(new Error('Настройки в мире только что изменились.'), {conflict: true});
      if (!reply.includes('BaranusChaos:PART ')) throw new Error(explain(reply, ''));
    }
    throw new Error('Мод не подтвердил сохранение общих настроек.');
  }

  /** Доступ друга по сети (Radmin VPN): включить/выключить (enable) или узнать состояние (undefined). */
  async remote(connection, enable) {
    const suffix = enable === undefined ? '' : enable ? ' on' : ' off';
    const reply = await this.run(connection, 'baranuschaos remote' + suffix);
    const match = reply.match(/BaranusChaos:REMOTE ([01]) ([A-Z0-9]+)/);
    if (!match) throw new Error(explain(reply, ''));
    return {enabled: match[1] === '1', code: match[2]};
  }

  async setPaused(connection, paused) {
    const reply = await this.run(connection, `baranuschaos ${paused ? 'pause' : 'resume'}`);
    if (!reply.includes(`BaranusChaos:PAUSE ${paused ? 1 : 0}`)) throw new Error(explain(reply, ''));
  }
}
