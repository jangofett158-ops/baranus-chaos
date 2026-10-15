import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {CATEGORIES, effectByCode} from './catalog.mjs';
import {applyPatch, loadSettings, effectiveEvents, CURRENCIES, RUB_RATES, CUSTOM_RE} from './settings.mjs';
import {matchDonation, extractDonation, normalizeDonation, resolveRandom, describe} from './matcher.mjs';
import {MinecraftBridge, MOD_VERSION} from './minecraft.mjs';
import {OAuthFlow, DonationStream, DonationPoller, createApi, requestToken, DEFAULT_CLIENT_ID, REDIRECT_URI, HttpError} from './donationalerts.mjs';
import {DonationLedger} from './ledger.mjs';
import {fetchRates, RATES_SOURCE} from './rates.mjs';
import {readJson, writeJson, SecretStore} from './store.mjs';

export const APP_VERSION = '1.2.5';
const HISTORY_LIMIT = 200;

const STATIC = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/app.css': ['app.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/overlay': ['overlay.html', 'text/html'],
  '/overlay.html': ['overlay.html', 'text/html'],
  '/overlay.js': ['overlay.js', 'text/javascript'],
  '/oauth/callback': ['oauth.html', 'text/html'],
  '/oauth.js': ['oauth.js', 'text/javascript'],
  '/icon.png': ['icon.png', 'image/png']
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** Перенос настроек из версии 0.4.0 (та же папка данных %APPDATA%\baranus-chaos\data). */
function migrateLegacy(dataDir, secrets) {
  const legacy = name => readJson(path.join(dataDir, name), null);
  const patch = {};
  const connection = legacy('connection.json');
  if (connection) {
    patch.minecraft = {
      host: connection.MC_RCON_HOST || '127.0.0.1',
      port: Number(connection.MC_RCON_PORT || 25575),
      player: connection.MC_PLAYER && connection.MC_PLAYER !== 'Steve' ? connection.MC_PLAYER : '',
      simulate: connection.DRY_RUN !== 'false'
    };
    if (/^\d{1,12}$/.test(connection.DA_CLIENT_ID || '')) patch.daClientId = connection.DA_CLIENT_ID;
    if (typeof connection.MC_RCON_PASSWORD === 'string' && connection.MC_RCON_PASSWORD) secrets.set('rconPassword', connection.MC_RCON_PASSWORD);
  }
  const overlay = legacy('overlay.json');
  if (overlay) patch.overlay = {...overlay, duration: Math.min(30, Math.max(2, Number(overlay.duration) || 6))};
  const config = legacy('config.json');
  if (Array.isArray(config?.events)) {
    patch.events = {};
    for (const item of config.events) if (effectByCode(item?.code)) patch.events[item.code] = {price: item.price, enabled: item.enabled};
    if (CURRENCIES.includes(config.events[0]?.currency)) patch.currency = config.events[0].currency;
  }
  if (legacy('paused.json') === true) patch.paused = true;
  return Object.keys(patch).length ? loadSettings(patch) : null;
}

/**
 * Client Secret и refresh-токен из 0.4.0 нужны для входа приложением с секретом.
 * Переносятся при каждом запуске, если их ещё нет (в 1.0.0 они не переносились).
 */
function importLegacyDonationAlerts(dataDir, secrets, settings) {
  const connection = readJson(path.join(dataDir, 'connection.json'), null);
  const clientId = settings.daClientId || DEFAULT_CLIENT_ID;
  if (!secrets.get('daClientSecret') && typeof connection?.DA_CLIENT_SECRET === 'string' && connection.DA_CLIENT_SECRET
    && String(connection.DA_CLIENT_ID) === clientId) secrets.set('daClientSecret', connection.DA_CLIENT_SECRET);
  const tokens = readJson(path.join(dataDir, 'tokens.json'), null);
  const saved = secrets.get('daToken');
  if (typeof tokens?.access_token === 'string' && (!saved?.token || (saved.token === tokens.access_token && !saved.refreshToken)))
    secrets.set('daToken', {token: tokens.access_token, expiresAt: Number(tokens.expires_at) || null, refreshToken: tokens.refresh_token || null});
}

export const LOCAL_BRIDGE_PORT = 25585;

export function createApp({dataDir, publicDir, port = 3217, host = '127.0.0.1', protector = null, send, fetchImpl,
  websocketFactory, random = Math.random, statusIntervalMs = 5000, pollIntervalMs = 5000, ratesIntervalMs = 6 * 3_600_000, now = Date.now}) {
  fs.mkdirSync(dataDir, {recursive: true});
  const files = {
    settings: path.join(dataDir, 'settings.json'),
    history: path.join(dataDir, 'events-log.json'),
    secrets: path.join(dataDir, 'secrets.json'),
    ledger: path.join(dataDir, 'processed-donations.json')
  };
  const secrets = new SecretStore(files.secrets, protector);
  let settings;
  if (fs.existsSync(files.settings)) settings = loadSettings(readJson(files.settings, null));
  else {
    settings = migrateLegacy(dataDir, secrets) || loadSettings(null);
    writeJson(files.settings, settings);
  }
  importLegacyDonationAlerts(dataDir, secrets, settings);
  const ledger = new DonationLedger(files.ledger);
  const savedHistory = readJson(files.history, []);
  const history = Array.isArray(savedHistory) ? savedHistory.slice(0, HISTORY_LIMIT) : [];
  const events = new EventEmitter();
  const clients = new Set();
  const bridge = new MinecraftBridge({send});
  const oauth = new OAuthFlow({now});
  let actualPort = port;
  let da = {state: 'off', message: '', profile: null};
  let wsStatus = {state: 'off'}, pollStatus = {state: 'off'}, profileInfo = null;
  const daLog = [];
  let mc = {state: 'off', message: '', version: '', paused: false, players: []};
  let polling = null, pollTimer = null, ratesTimer = null;
  let rates = {state: 'idle', updatedAt: null, message: '', source: RATES_SOURCE};

  const saveSettings = next => { settings = next; writeJson(files.settings, settings); };

  /** Подтянуть актуальные курсы для добавленных валют. При ошибке остаются прежние (или примерные). */
  async function refreshRates() {
    const extras = Object.keys(settings.extraCurrencies);
    if (!extras.length) return;
    try {
      const fresh = await fetchRates(settings.currency, extras, fetchImpl);
      const patch = Object.fromEntries(Object.entries(fresh.rates).filter(([currency]) => settings.extraCurrencies[currency]).map(([currency, rate]) => [currency, {rate}]));
      if (Object.keys(patch).length) saveSettings(applyPatch(settings, {extraCurrencies: patch}));
      rates = {state: 'ok', updatedAt: fresh.updatedAt, message: '', source: RATES_SOURCE};
    } catch (error) {
      rates = {...rates, state: 'error', message: `Не удалось обновить курсы: ${error.message}`};
    }
    pushState();
  }
  const isLocal = () => settings.minecraft.mode === 'local';
  // Локальный мир: мост мода на 127.0.0.1:25585, пароль не нужен.
  const connection = () => isLocal()
    ? {host: '127.0.0.1', port: LOCAL_BRIDGE_PORT, password: 'local'}
    : {host: settings.minecraft.host, port: settings.minecraft.port, password: secrets.get('rconPassword') || ''};
  // Если ник не указан, а в мире один игрок — события идут ему.
  const targetPlayer = () => settings.minecraft.player || (mc.players.length === 1 ? mc.players[0] : '');
  const clientId = () => settings.daClientId || DEFAULT_CLIENT_ID;

  function snapshot(full = false) {
    const state = {
      version: APP_VERSION,
      modVersion: MOD_VERSION,
      settings: {...settings, minecraft: {...settings.minecraft, hasPassword: !!secrets.get('rconPassword')}, hasDaSecret: !!secrets.get('daClientSecret')},
      defaultClientId: DEFAULT_CLIENT_ID,
      rates,
      da: {...da, hasToken: !!secrets.get('daToken')?.token, log: daLog.slice(-12)},
      mc: {...mc, target: targetPlayer(), playerOnline: !!targetPlayer() && mc.players.includes(targetPlayer())}
    };
    state.catalog = effectiveEvents(settings);
    if (full) Object.assign(state, {categories: CATEGORIES, currencies: CURRENCIES, rubRates: RUB_RATES, history: history.slice(0, 80)});
    return state;
  }

  function broadcast(type, payload) {
    const data = `data: ${JSON.stringify({type, ...payload})}\n\n`;
    for (const client of clients) try { client.write(data); } catch { clients.delete(client); }
  }
  const pushState = () => broadcast('state', {state: snapshot()});

  function addHistory(item) {
    const entry = {id: randomBytes(6).toString('hex'), at: new Date(now()).toISOString(), ...item};
    history.unshift(entry);
    history.splice(HISTORY_LIMIT);
    writeJson(files.history, history);
    broadcast('history', {entry});
    return entry;
  }

  // ---------- Minecraft ----------
  async function refreshMinecraft() {
    if (polling) return polling;
    polling = (async () => {
      let next;
      if (settings.minecraft.simulate) next = {state: 'simulate', message: 'Симуляция: события не отправляются в игру.', version: '', paused: false, players: []};
      else if (!isLocal() && !secrets.get('rconPassword')) next = {state: 'off', message: 'Введите адрес и пароль RCON.', version: '', paused: false, players: []};
      else {
        try {
          const status = await bridge.status(connection());
          const mismatch = status.version !== MOD_VERSION;
          next = {state: mismatch ? 'version' : 'online', version: status.version, paused: status.paused, players: status.players,
            message: mismatch ? `В игре мод ${status.version}, нужен ${MOD_VERSION}.` : ''};
        } catch (error) {
          const message = isLocal() && /недоступен|ECONNREFUSED|не отвечает|закрыл/.test(error.message)
            ? `Мир не запущен. Откройте мир в Minecraft с модом Baranus Chaos ${MOD_VERSION} — приложение подключится само.`
            : error.message;
          next = {state: 'error', message, version: '', paused: false, players: []};
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(mc)) { mc = next; pushState(); }
    })().finally(() => { polling = null; });
    return polling;
  }

  // ---------- События ----------
  async function execute({code, kind, donor, amount = null, currency = settings.currency, message = '', via = 'manual', pool = 1, donationId = null, replayOf = null}) {
    const actual = resolveRandom(code, settings, random);
    const base = {kind, donor, amount, currency, message, code: actual, requested: code, via, pool, donationId, replayOf};
    const simulated = settings.minecraft.simulate;
    try {
      if (!simulated) {
        if (!targetPlayer() && isLocal()) await refreshMinecraft();
        const custom = settings.customEvents[actual];
        if (custom) await bridge.custom(connection(), targetPlayer(), donor, custom.name, custom.commands, {test: kind === 'test'});
        else await bridge.trigger(connection(), actual, targetPlayer(), donor, {test: kind === 'test'});
      }
      addHistory({...base, state: simulated ? 'simulated' : 'done'});
      const info = describe(actual, settings);
      broadcast('alert', {alert: {icon: info.icon, name: info.name, donor, amount, currency, test: kind !== 'donation' && kind !== 'replay'}});
      return {ok: true, code: actual, simulated};
    } catch (error) {
      addHistory({...base, state: 'failed', reason: error.message});
      refreshMinecraft();
      return {ok: false, error: error.message};
    }
  }

  async function processDonation(donation, kind) {
    const match = matchDonation(donation, settings, random);
    const base = {kind, donor: donation.username, amount: donation.amount, currency: donation.currency, message: donation.message, donationId: donation.id};
    if (!match.code) { addHistory({...base, state: 'ignored', reason: match.reason}); return {ok: false, error: match.reason}; }
    if (settings.paused) {
      addHistory({...base, code: match.code, requested: match.code, via: match.via, pool: match.pool, state: 'skipped', reason: 'Хаос был на паузе.'});
      return {ok: false, error: 'Хаос на паузе.'};
    }
    return execute({...base, code: match.code, via: match.via, pool: match.pool});
  }

  // Каждый донат обрабатывается сразу и независимо — никакой очереди.
  async function onDonation(payload) {
    const donation = extractDonation(payload);
    if (!donation || !ledger.reserve(donation.id)) return;
    await processDonation(donation, 'donation');
  }

  // ---------- DonationAlerts ----------
  async function refreshDaToken() {
    const saved = secrets.get('daToken');
    const secret = secrets.get('daClientSecret');
    if (!saved?.refreshToken || !secret) return false;
    const fresh = await requestToken({grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: clientId(),
      client_secret: secret}, fetchImpl); // без scope: refresh сохраняет разрешения исходного входа
    secrets.set('daToken', {...fresh, refreshToken: fresh.refreshToken || saved.refreshToken});
    return true;
  }

  // Журнал подключения DonationAlerts (без токенов): файл donationalerts.log и последние строки в интерфейсе.
  const daLogFile = path.join(dataDir, 'donationalerts.log');
  function logDa(text) {
    const line = `${new Date(now()).toLocaleTimeString('ru-RU')} ${text}`;
    daLog.push(line);
    daLog.splice(0, Math.max(0, daLog.length - 30));
    try {
      if (fs.existsSync(daLogFile) && fs.statSync(daLogFile).size > 256_000) fs.renameSync(daLogFile, daLogFile + '.old');
      fs.appendFileSync(daLogFile, `${new Date(now()).toISOString()} ${text}\n`);
    } catch { /* журнал не критичен */ }
    broadcast('dalog', {line});
  }

  const stream = new DonationStream({
    api: createApi(fetchImpl),
    websocketFactory,
    log: logDa,
    refreshToken: async () => {
      logDa('токен отклонён (401) — обновляю через refresh-токен');
      const ok = await refreshDaToken();
      logDa(ok ? 'токен обновлён' : 'обновить токен нельзя (нет refresh-токена или Client Secret)');
      return ok;
    },
    getToken: getDaToken,
    onDonation,
    onProfile: profile => { profileInfo = {name: profile.name, code: profile.code, avatar: profile.avatar}; updateDa(); },
    onStatus: status => {
      wsStatus = status;
      if (status.state === 'auth') { secrets.set('daToken', null); poller.stop(); profileInfo = null; }
      if (status.state === 'off') profileInfo = null;
      updateDa();
    }
  });

  // Запасной опрос списка донатов: работает, даже если подписка Centrifugo падает на стороне DonationAlerts.
  const poller = new DonationPoller({
    api: createApi(fetchImpl), getToken: getDaToken, onDonation, log: logDa, intervalMs: pollIntervalMs,
    onStatus: status => { pollStatus = status; updateDa(); }
  });

  async function getDaToken() {
    let saved = secrets.get('daToken');
    if (!saved?.token) throw new HttpError(401, 'Нет входа в DonationAlerts.');
    if (saved.expiresAt && saved.expiresAt < now() + 60_000) {
      if (!(await refreshDaToken())) throw new HttpError(401, 'Сессия истекла.');
      saved = secrets.get('daToken');
    }
    return saved.token;
  }

  /** Итоговое состояние: онлайн, если работает хотя бы один канал (WebSocket или опрос). */
  function updateDa() {
    const ws = wsStatus.state, poll = pollStatus.state;
    if (ws === 'online') da = {state: 'online', channel: 'realtime', message: '', profile: profileInfo};
    else if (poll === 'ok') da = {state: 'online', channel: 'polling', profile: profileInfo,
      message: 'Донаты проверяются каждые несколько секунд: подписка в реальном времени сейчас недоступна на стороне DonationAlerts.'};
    else if (poll === 'scope' && ws !== 'off' && ws !== 'auth') da = {state: 'error', channel: '', profile: profileInfo,
      message: `${wsStatus.message || 'Подписка DonationAlerts не работает.'} Запасной опрос требует нового входа: нажмите «Выйти и войти заново».`};
    else da = {state: ws, channel: '', message: wsStatus.message || '', profile: ws === 'off' || ws === 'auth' ? null : profileInfo};
    pushState();
  }

  function startDa() {
    stream.stop({state: 'connecting'});
    poller.stop();
    stream.start();
    poller.start();
  }

  function stopDa() {
    poller.stop();
    stream.stop();
  }

  // ---------- HTTP ----------
  const json = (res, value, status = 200) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(value));
  };

  async function readBody(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16_384) throw new Error('Слишком большой запрос.');
    }
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Неверный запрос.');
    return value;
  }

  const routes = {
    'POST /api/settings': async body => {
      const allowed = ['currency', 'extraCurrencies', 'recalcPrices', 'codeTrigger', 'paused', 'events', 'overlay'];
      const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
      saveSettings(applyPatch(settings, patch));
      if ('overlay' in patch) broadcast('overlay', {overlay: settings.overlay});
      // Новая валюта или другая основная — сразу берём актуальный курс.
      if ('extraCurrencies' in patch || 'currency' in patch) await refreshRates();
      pushState();
      return snapshot();
    },
    'POST /api/rates/refresh': async () => {
      await refreshRates();
      if (rates.state === 'error') throw new Error(rates.message);
      return snapshot();
    },
    'POST /api/minecraft': async body => {
      const change = {mode: body.mode ?? settings.minecraft.mode, player: body.player ?? '', simulate: !!body.simulate};
      if (body.host !== undefined && body.host !== '') change.host = body.host;
      if (body.port !== undefined && body.port !== '' && body.port !== 0) change.port = body.port;
      const next = applyPatch(settings, {minecraft: change});
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length > 512 || /[\r\n\0]/.test(body.password)) throw new Error('Некорректный пароль RCON.');
        secrets.set('rconPassword', body.password);
      }
      saveSettings(next);
      await refreshMinecraft();
      pushState();
      return snapshot();
    },
    'POST /api/minecraft/check': async () => { await refreshMinecraft(); return snapshot(); },
    'POST /api/minecraft/resume': async () => { await bridge.setPaused(connection(), false); await refreshMinecraft(); return snapshot(); },
    'POST /api/cleanup': async () => {
      if (settings.minecraft.simulate) return {ok: true, removed: 0, simulated: true};
      return {ok: true, removed: await bridge.cleanup(connection(), targetPlayer())};
    },
    // Создание и редактирование событий. Без code — новое своё событие.
    'POST /api/events/save': async body => {
      const code = body.code ? String(body.code) : `c_${randomBytes(4).toString('hex')}`;
      const fields = {price: body.price, enabled: body.enabled ?? true};
      if (body.prices && typeof body.prices === 'object') fields.prices = body.prices;
      if (effectByCode(code)) {
        saveSettings(applyPatch(settings, {events: {[code]: {...fields, name: body.name, icon: body.icon, desc: body.desc ?? ''}}}));
      } else {
        if (!CUSTOM_RE.test(code)) throw new Error('Неизвестное событие.');
        let next = applyPatch(settings, {customEvents: {[code]: {name: body.name, icon: body.icon, desc: body.desc ?? '', commands: body.commands}}});
        next = applyPatch(next, {events: {[code]: fields}});
        saveSettings(next);
      }
      pushState();
      return {...snapshot(), savedCode: code};
    },
    'POST /api/events/delete': async body => {
      const code = String(body.code || '');
      if (effectByCode(code)) saveSettings(applyPatch(settings, {events: {[code]: {reset: true}}})); // встроенные — только сброс
      else if (settings.customEvents[code]) saveSettings(applyPatch(settings, {customEvents: {[code]: null}}));
      else throw new Error('Неизвестное событие.');
      pushState();
      return snapshot();
    },
    'POST /api/test/effect': async body => {
      if (!effectByCode(body.code) && !settings.customEvents[body.code]) throw new Error('Неизвестное событие.');
      return execute({code: body.code, kind: 'test', donor: 'Тест'});
    },
    'POST /api/test/donation': async body => {
      const currency = settings.extraCurrencies[body.currency] ? body.currency : settings.currency;
      const donation = normalizeDonation({id: 'test-' + randomBytes(6).toString('hex'), amount: body.amount, currency,
        username: String(body.username || '').trim() || 'Тестовый зритель', message: body.message || ''});
      if (!donation) throw new Error('Введите сумму больше нуля.');
      return processDonation(donation, 'test-donation');
    },
    'POST /api/replay': async body => {
      const entry = history.find(item => item.id === body.id);
      if (!entry || !['failed', 'skipped'].includes(entry.state) || !entry.code || entry.replayed) throw new Error('Это событие нельзя повторить.');
      entry.replayed = true;
      writeJson(files.history, history);
      broadcast('replayed', {id: entry.id});
      return execute({code: entry.requested || entry.code, kind: 'replay', donor: entry.donor, amount: entry.amount, currency: entry.currency,
        message: entry.message, via: entry.via, pool: entry.pool, replayOf: entry.id});
    },
    'POST /api/da/login': async () => {
      const code = !!secrets.get('daClientSecret');
      logDa(`вход через браузер: Client ID ${clientId()}, схема ${code ? 'код + секрет' : 'implicit (без секрета)'}`);
      return {url: oauth.begin(clientId(), {code})};
    },
    'POST /api/da/reconnect': async () => {
      logDa('переподключение по кнопке');
      startDa();
      return snapshot();
    },
    'POST /api/da/session': async body => {
      let result;
      try { result = oauth.consume(body); } catch (error) { logDa(`вход отклонён: ${error.message}`); throw error; }
      logDa(result.code ? 'получен код входа, меняю на токен' : 'получен токен из браузера');
      let session;
      try {
        session = result.code
          ? await requestToken({grant_type: 'authorization_code', client_id: clientId(), client_secret: secrets.get('daClientSecret'),
            redirect_uri: REDIRECT_URI, code: result.code}, fetchImpl)
          : {token: result.token, expiresAt: result.expiresAt, refreshToken: null};
      } catch (error) {
        logDa(`обмен кода не удался: ${error.message}`);
        da = {state: 'error', message: error.message, profile: null};
        pushState();
        throw error;
      }
      secrets.set('daToken', session);
      startDa();
      events.emit('da-connected');
      return {ok: true};
    },
    'POST /api/da/logout': async () => {
      secrets.set('daToken', null);
      logDa('выход из DonationAlerts');
      stopDa();
      return snapshot();
    },
    'POST /api/da/client-id': async body => {
      saveSettings(applyPatch(settings, {daClientId: body.clientId ?? ''}));
      if (body.clearSecret) secrets.set('daClientSecret', null);
      else if (typeof body.clientSecret === 'string' && body.clientSecret.trim()) {
        const secret = body.clientSecret.trim();
        if (secret.length > 512 || /\s/.test(secret)) throw new Error('Некорректный Client Secret.');
        secrets.set('daClientSecret', secret);
      }
      pushState();
      return snapshot();
    },
    'POST /api/overlay/test': async () => {
      broadcast('alert', {alert: {icon: '👹', name: 'Огненный гигант', donor: 'Тест оверлея', amount: settings.events.giantzombie.price, currency: settings.currency, test: true}});
      return {ok: true};
    }
  };

  async function handle(req, res) {
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!allowedHosts.includes(String(req.headers.host || ''))) return json(res, {error: 'Недопустимый Host.'}, 403);
    const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    const route = url.pathname;

    if (req.method === 'GET' && STATIC[route]) {
      const [file, type] = STATIC[route];
      res.writeHead(200, {'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP});
      fs.createReadStream(path.join(publicDir, file)).pipe(res);
      return;
    }
    if (req.method === 'GET' && route === '/api/state') return json(res, snapshot(true));
    if (req.method === 'GET' && route === '/api/stream') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff'});
      res.write(`retry: 1500\ndata: ${JSON.stringify({type: 'overlay', overlay: settings.overlay})}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const handler = routes[`${req.method} ${route}`];
    if (!handler) return json(res, {error: 'Не найдено.'}, 404);
    // Защита от запросов со сторонних сайтов: свой заголовок + JSON + локальный Origin.
    const origin = req.headers.origin;
    if (origin && !allowedHosts.map(item => `http://${item}`).includes(origin)) return json(res, {error: 'Запрещённый источник запроса.'}, 403);
    if (req.headers['x-baranus'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json'))
      return json(res, {error: 'Неверный запрос.'}, 400);
    try {
      const result = await handler(await readBody(req));
      return json(res, result, result?.ok === false ? 422 : 200);
    } catch (error) {
      return json(res, {error: error.message}, 400);
    }
  }

  const server = http.createServer((req, res) => handle(req, res).catch(error => json(res, {error: error.message}, 500)));

  return {
    server,
    events,
    get port() { return actualPort; },
    snapshot,
    onDonation,
    refreshMinecraft,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          actualPort = server.address().port;
          if (secrets.get('daToken')?.token) startDa();
          refreshMinecraft();
          pollTimer = setInterval(() => refreshMinecraft(), statusIntervalMs);
          pollTimer.unref?.();
          if (ratesIntervalMs) {
            refreshRates();
            ratesTimer = setInterval(() => refreshRates(), ratesIntervalMs);
            ratesTimer.unref?.();
          }
          resolve(actualPort);
        });
      });
    },
    async close() {
      clearInterval(pollTimer);
      clearInterval(ratesTimer);
      stopDa();
      for (const client of clients) client.end();
      clients.clear();
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections?.();
      await closed;
    }
  };
}
