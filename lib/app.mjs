import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {CATEGORIES, effectByCode} from './catalog.mjs';
import {applyPatch, defaultSettings, loadSettings, effectiveEvents, exportShared, importShared, mergeShared, stableJson, SHARED_KEYS, CURRENCIES, FRACTIONAL, RUB_RATES, CUSTOM_RE} from './settings.mjs';
import {matchDonation, extractDonation, normalizeDonation, resolveRandom, describe} from './matcher.mjs';
import {MinecraftBridge, MOD_VERSION} from './minecraft.mjs';
import {OAuthFlow, DonationStream, DonationPoller, createApi, requestToken, DEFAULT_CLIENT_ID, REDIRECT_URI, HttpError} from './donationalerts.mjs';
import {DonationLedger} from './ledger.mjs';
import {fetchRates, RATES_SOURCE} from './rates.mjs';
import {readJson, writeJson, SecretStore} from './store.mjs';

export const APP_VERSION = '1.5.4';
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
  '/icon.png': ['icon.png', 'image/png'],
  // Шрифт в стиле Minecraft (Monocraft, лицензия SIL OFL 1.1 - fonts/OFL.txt)
  '/fonts/Monocraft.ttf': ['fonts/Monocraft.ttf', 'font/ttf'],
  '/fonts/Monocraft-Bold.ttf': ['fonts/Monocraft-Bold.ttf', 'font/ttf']
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
      player: connection.MC_PLAYER && connection.MC_PLAYER !== 'Steve' ? connection.MC_PLAYER : ''
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
  websocketFactory, random = Math.random, statusIntervalMs = 5000, pollIntervalMs = 5000, queueTickMs = 1000, ratesIntervalMs = 6 * 3_600_000, now = Date.now}) {
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
  let remoteInfo = {enabled: false, code: ''};

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
  const mode = () => settings.minecraft.mode;
  const isLocal = () => mode() === 'local';
  // Свой мир — мост мода на 127.0.0.1:25585 без пароля; мир друга — тот же мост по Radmin VPN с кодом доступа.
  const connection = () => mode() === 'local'
    ? {host: '127.0.0.1', port: LOCAL_BRIDGE_PORT, password: 'local'}
    : mode() === 'friend'
      ? {host: settings.minecraft.friendHost, port: LOCAL_BRIDGE_PORT, password: secrets.get('friendCode') || ''}
      : {host: settings.minecraft.host, port: settings.minecraft.port, password: secrets.get('rconPassword') || ''};

  /** Адреса этого ПК в Radmin VPN (26.x.x.x) — их другу нужно ввести для подключения. */
  function radminAddresses() {
    const found = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item.family !== 'IPv4' || item.internal) continue;
        if (/radmin/i.test(name) || item.address.startsWith('26.')) found.push(item.address);
      }
    }
    return [...new Set(found)];
  }

  // ---------- Синхронизация общих настроек через мир ----------
  const syncFile = path.join(dataDir, 'sync.json');
  let sync = {revision: 0, dirty: false, ...readJson(syncFile, {})};
  let syncState = {state: 'idle', message: '', at: null};
  let syncBusy = null, pushTimer = null;
  // base — общие настройки на момент последней синхронизации: по ним видно, что поменяли здесь, а что — в мире.
  const saveSync = () => writeJson(syncFile, {revision: sync.revision, dirty: sync.dirty, base: sync.base ?? null});
  const canSync = () => !settings.minecraft.simulate && mc.state === 'online';
  const backupDir = path.join(dataDir, 'backups');

  /** Копия своих настроек событий перед заменой настройками из мира (хранятся последние 10). */
  function backupShared() {
    try {
      fs.mkdirSync(backupDir, {recursive: true});
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      writeJson(path.join(backupDir, `events-${stamp}.json`), exportShared(settings));
      const old = fs.readdirSync(backupDir).filter(name => /^events-.*.json$/.test(name)).sort();
      for (const name of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(backupDir, name), {force: true});
    } catch { /* копия не обязательна для работы */ }
  }

  /** pull — забрать настройки из мира (если там пусто — отдать свои); push — сохранить свои в мир,
   *  а если мир успел измениться (правка второго стримера) — сначала слить его правки со своими. */
  function syncNow(action) {
    if (syncBusy) return syncBusy;
    syncBusy = (async () => {
      try {
        if (action === 'pull') {
          const remote = await bridge.syncGet(connection());
          if (remote.data) {
            backupShared();
            saveSettings(importShared(settings, remote.data));
            sync = {revision: remote.revision, dirty: false, base: exportShared(settings)};
            saveSync();
            syncState = {state: 'ok', message: 'Настройки событий получены из мира', at: now()};
            return;
          }
        }
        let shared = exportShared(settings);
        if (sync.base && sync.revision > 0) {
          const remote = await bridge.syncGet(connection());
          if (remote.data && remote.revision !== sync.revision) {
            const merged = mergeShared(sync.base, shared, remote.data);
            if (stableJson(merged) !== stableJson(shared)) {
              backupShared();
              saveSettings(importShared(settings, merged));
              shared = exportShared(settings);
            }
          }
        }
        const revision = await bridge.syncPut(connection(), shared);
        sync = {revision, dirty: false, base: shared};
        saveSync();
        syncState = {state: 'ok', message: 'Настройки событий сохранены в мир', at: now()};
      } catch (error) {
        syncState = {state: 'error', message: 'Синхронизация: ' + error.message, at: now()};
      } finally {
        pushState();
      }
    })().finally(() => { syncBusy = null; });
    return syncBusy;
  }

  /** Настройки событий никто не менял (свежая установка). */
  const pristine = () => stableJson(exportShared(settings)) === stableJson(exportShared(defaultSettings()));

  /** Сравнить ревизию мира со своей: свои несохранённые правки — отправить, у мира новее — забрать.
   *  Уже настроенное приложение при первой синхронизации в своём мире отдаёт свои настройки, а не затирает их миром. */
  function syncCheck(worldRevision) {
    if (!canSync()) return;
    const firstOwn = isLocal() && sync.revision === 0 && !pristine();
    if (sync.dirty || worldRevision === 0 || firstOwn) syncNow('push');
    else if (worldRevision !== sync.revision) syncNow('pull');
  }

  /** Общие настройки изменились здесь — отправить в мир (с небольшой задержкой, чтобы собрать правки). */
  function markShared() {
    sync.dirty = true;
    saveSync();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (canSync()) syncNow('push'); }, 800);
    pushTimer.unref?.();
  }

  // ---------- Очередь событий ----------
  const queueFile = path.join(dataDir, 'queue.json');
  const savedQueue = readJson(queueFile, []);
  let queue = Array.isArray(savedQueue) ? savedQueue.filter(item => item && item.id && item.code) : [];
  let queueBusy = false, queueTimer = null;
  const localClaims = {lastAt: 0};
  const queueView = () => [...queue].sort((a, b) => a.dueAt - b.dueAt)
    .map(({id, code, donor, amount, currency, kind, dueAt, retryAt, note}) => ({id, code, donor, amount, currency, kind, dueAt, retryAt, note}));
  const saveQueue = () => { writeJson(queueFile, queue); broadcast('queue', {queue: queueView()}); };

  /** Без мода (симуляция) — та же пауза между событиями, что и в моде. */
  function localClaim(gap) {
    const t = now();
    const wait = localClaims.lastAt + gap * 1000 - t;
    if (wait > 0) return wait;
    localClaims.lastAt = t;
    return 0;
  }

  /**
   * Донат встаёт в очередь через «Задержку» после себя, но не раньше чем через «Задержку» после предыдущего
   * в очереди: так каждое событие успевает отыграть, прежде чем начнётся следующее.
   */
  function enqueue(item) {
    const step = settings.queue.delay * 1000;
    const last = queue.reduce((latest, other) => Math.max(latest, other.dueAt), 0);
    const entry = {id: randomBytes(6).toString('hex'), dueAt: Math.max(now() + step, last + step), ...item};
    queue.push(entry);
    saveQueue();
    setImmediate(processQueue);
    return entry;
  }

  /** Один такт очереди: первое созревшее событие, которому мод разрешил запуск (общая пауза между событиями обоих стримеров). */
  async function processQueue() {
    if (queueBusy || settings.paused || !queue.length) return;
    queueBusy = true;
    let changed = false;
    try {
      const t = now();
      const ready = queue.filter(item => item.dueAt <= t && (item.retryAt || 0) <= t).sort((a, b) => a.dueAt - b.dueAt);
      for (const item of ready.slice(0, 5)) {
        // Между событиями обоих стримеров — та же «Задержка», что и в очереди.
        let wait;
        try {
          wait = settings.minecraft.simulate
            ? localClaim(settings.queue.delay)
            : await bridge.claim(connection(), item.code, settings.queue.delay, 0);
        } catch (error) {
          item.retryAt = now() + 5000;
          item.note = error.message;
          changed = true;
          break;
        }
        if (wait > 0) {
          item.retryAt = now() + Math.min(wait, 60_000);
          item.note = '';
          changed = true;
          continue;
        }
        queue = queue.filter(other => other.id !== item.id);
        saveQueue();
        changed = false;
        await execute(item);
        break;
      }
    } finally {
      queueBusy = false;
      if (changed) saveQueue();
    }
  }
  // Если ник не указан, а в мире один игрок — события идут ему.
  // Ник стримера: его сообщает мод; ник вручную — только для сервера по RCON, где мод не видит, кто подключился.
  const targetPlayer = () => mc.me || (mode() === 'rcon' && settings.minecraft.player) || (mc.players.length === 1 ? mc.players[0] : '');
  const clientId = () => settings.daClientId || DEFAULT_CLIENT_ID;

  function snapshot(full = false) {
    const state = {
      version: APP_VERSION,
      modVersion: MOD_VERSION,
      settings: {...settings, minecraft: {...settings.minecraft, hasPassword: !!secrets.get('rconPassword'), hasFriendCode: !!secrets.get('friendCode')}, hasDaSecret: !!secrets.get('daClientSecret')},
      defaultClientId: DEFAULT_CLIENT_ID,
      rates,
      queue: queueView(),
      sync: {...syncState, revision: sync.revision, dirty: sync.dirty},
      remote: isLocal() ? {...remoteInfo, addresses: radminAddresses()} : {enabled: false, code: '', addresses: []},
      da: {...da, hasToken: !!secrets.get('daToken')?.token, log: daLog.slice(-12)},
      mc: {...mc, target: targetPlayer(), playerOnline: !!targetPlayer() && mc.players.includes(targetPlayer())}
    };
    state.catalog = effectiveEvents(settings);
    if (full) Object.assign(state, {categories: CATEGORIES, currencies: CURRENCIES, fractional: FRACTIONAL, rubRates: RUB_RATES, history: history.slice(0, 80)});
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
      let next, worldRevision = null;
      if (settings.minecraft.simulate) next = {state: 'simulate', message: 'Симуляция: события не отправляются в игру.', version: '', paused: false, players: []};
      else if (mode() === 'rcon' && !secrets.get('rconPassword')) next = {state: 'off', message: 'Введите адрес и пароль RCON.', version: '', paused: false, players: []};
      else if (mode() === 'friend' && (!settings.minecraft.friendHost || !secrets.get('friendCode')))
        next = {state: 'off', message: 'Введите адрес друга в Radmin VPN и код доступа.', version: '', paused: false, players: []};
      else {
        try {
          const status = await bridge.status(connection());
          const mismatch = status.version !== MOD_VERSION;
          next = {state: mismatch ? 'version' : 'online', version: status.version, paused: status.paused, players: status.players,
            remote: status.remote, me: status.me, message: mismatch ? `В игре мод ${status.version}, нужен ${MOD_VERSION}.` : ''};
          worldRevision = status.revision;
        } catch (error) {
          const offline = /недоступен|ECONNREFUSED|не отвечает|закрыл|ETIMEDOUT|EHOSTUNREACH/.test(error.message);
          const message = isLocal() && offline
            ? `Мир не запущен. Откройте мир в Minecraft с модом Baranus Chaos ${MOD_VERSION} - приложение подключится само.`
            : mode() === 'friend' && offline
              ? 'Мир друга недоступен: проверьте Radmin VPN, адрес и что друг включил «Совместную игру».'
              : mode() === 'friend' && /пароль/.test(error.message) ? 'Неверный код доступа - спросите его у друга.' : error.message;
          next = {state: 'error', message, version: '', paused: false, players: []};
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(mc)) { mc = next; pushState(); }
      if (worldRevision !== null) syncCheck(worldRevision);
      if (mc.state === 'online' && isLocal() && mc.remote && !remoteInfo.code) {
        try { remoteInfo = await bridge.remote(connection()); pushState(); } catch { /* покажем позже */ }
      }
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
        // Кому: «all» — все стримеры в мире (@a), «receiver» — стример, которому пришёл донат (мобы рядом с ним).
        const event = effectiveEvents(settings).find(item => item.code === actual);
        const target = event?.target === 'all' ? '@a' : targetPlayer();
        const custom = settings.customEvents[actual];
        if (custom) await bridge.custom(connection(), target, donor, custom.name, custom.commands, {test: kind === 'test'});
        else await bridge.trigger(connection(), actual, target, donor, {test: kind === 'test'});
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
    // В очередь: событие сработает через settings.queue.delay секунд, с паузой между событиями.
    const item = enqueue({...base, code: match.code, via: match.via, pool: match.pool});
    return {ok: true, queued: true, code: match.code, dueAt: item.dueAt};
  }

  // Донат попадает в очередь сразу после получения; ID записывается до этого, повторов не будет.
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
      logDa('токен отклонён (401) - обновляю через refresh-токен');
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
      const allowed = ['currency', 'extraCurrencies', 'recalcPrices', 'codeTrigger', 'paused', 'queue', 'events', 'overlay'];
      const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
      saveSettings(applyPatch(settings, patch));
      if (SHARED_KEYS.some(key => key in patch)) markShared();
      if ('paused' in patch && !settings.paused) setImmediate(processQueue);
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
      const change = {mode: body.mode ?? settings.minecraft.mode, player: body.player ?? '', simulate: false};
      if (body.host !== undefined && body.host !== '') change.host = body.host;
      if (body.port !== undefined && body.port !== '' && body.port !== 0) change.port = body.port;
      if (body.friendHost !== undefined) change.friendHost = body.friendHost;
      if (typeof body.friendCode === 'string' && body.friendCode.trim()) {
        const code = body.friendCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{4,16}$/.test(code)) throw new Error('Код доступа - 8 латинских букв и цифр от друга.');
        secrets.set('friendCode', code);
      }
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
      if (body.target !== undefined && body.target !== '') fields.target = body.target;
      // Иконку в редакторе больше не выбирают: без неё остаётся прежняя (у нового своего события — ✨).
      const icon = body.icon ? {icon: body.icon} : {};
      if (effectByCode(code)) {
        saveSettings(applyPatch(settings, {events: {[code]: {...fields, name: body.name, ...icon, desc: body.desc ?? ''}}}));
      } else {
        if (!CUSTOM_RE.test(code)) throw new Error('Неизвестное событие.');
        let next = applyPatch(settings, {customEvents: {[code]: {name: body.name, ...icon, desc: body.desc ?? '', commands: body.commands}}});
        next = applyPatch(next, {events: {[code]: fields}});
        saveSettings(next);
      }
      markShared();
      pushState();
      return {...snapshot(), savedCode: code};
    },
    'POST /api/events/delete': async body => {
      const code = String(body.code || '');
      if (effectByCode(code)) saveSettings(applyPatch(settings, {events: {[code]: {reset: true}}})); // встроенные — только сброс
      else if (settings.customEvents[code]) saveSettings(applyPatch(settings, {customEvents: {[code]: null}}));
      else throw new Error('Неизвестное событие.');
      markShared();
      pushState();
      return snapshot();
    },
    // Очередь: запустить сейчас (без задержки и паузы) или отменить (останется в ленте, можно запустить позже).
    'POST /api/queue/run': async body => {
      const item = queue.find(entry => entry.id === body.id);
      if (!item) throw new Error('Этого события уже нет в очереди.');
      queue = queue.filter(entry => entry.id !== item.id);
      saveQueue();
      return execute(item);
    },
    'POST /api/queue/cancel': async body => {
      const item = queue.find(entry => entry.id === body.id);
      if (!item) throw new Error('Этого события уже нет в очереди.');
      queue = queue.filter(entry => entry.id !== item.id);
      saveQueue();
      const {id, dueAt, retryAt, note, ...rest} = item;
      addHistory({...rest, state: 'skipped', reason: 'Отменено в очереди.'});
      return snapshot();
    },
    // Совместная игра: разрешить другу подключаться к этому миру по Radmin VPN.
    'POST /api/remote': async body => {
      if (!isLocal()) throw new Error('Совместную игру включает тот, у кого запущен мир (режим «Свой мир»).');
      remoteInfo = await bridge.remote(connection(), !!body.enable);
      await refreshMinecraft();
      pushState();
      return snapshot();
    },
    'POST /api/sync': async () => {
      if (!canSync()) throw new Error('Нет подключения к миру.');
      await syncNow(sync.dirty ? 'push' : 'pull');
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
      broadcast('alert', {alert: {icon: '💚', name: 'Крипер', donor: 'Тест оверлея', amount: settings.events.creeper.price, currency: settings.currency, test: true}});
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
    processQueue,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          actualPort = server.address().port;
          if (secrets.get('daToken')?.token) startDa();
          refreshMinecraft();
          pollTimer = setInterval(() => refreshMinecraft(), statusIntervalMs);
          pollTimer.unref?.();
          queueTimer = setInterval(() => processQueue(), queueTickMs);
          queueTimer.unref?.();
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
      clearInterval(queueTimer);
      clearTimeout(pushTimer);
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
