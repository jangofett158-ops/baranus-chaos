import {randomBytes, timingSafeEqual} from 'node:crypto';

// Публичный идентификатор OAuth-приложения (не секрет). Вход идёт по Implicit Grant,
// поэтому Client Secret не нужен и не хранится. Можно заменить своим во вкладке «Подключения».
export const DEFAULT_CLIENT_ID = '21941';
export const REDIRECT_URI = 'http://127.0.0.1:3217/oauth/callback';
// oauth-donation-index — чтение списка донатов для запасного опроса (если подписка Centrifugo падает).
export const SCOPES = 'oauth-user-show oauth-donation-subscribe oauth-donation-index';
const API = 'https://www.donationalerts.com/api/v1';
const CENTRIFUGO = 'wss://centrifugo.donationalerts.com/connection/websocket';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApi(fetchImpl = globalThis.fetch) {
  return async function api(path, token, {method = 'GET', body} = {}) {
    const response = await fetchImpl(API + path, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const text = String(await response.text()).slice(0, 200);
      throw new HttpError(response.status, `DonationAlerts: HTTP ${response.status} ${text}`);
    }
    return response.json();
  };
}

export async function fetchProfile(api, token) {
  const data = (await api('/user/oauth', token))?.data;
  if (!data?.id || !data?.socket_connection_token) throw new Error('DonationAlerts не вернул данные профиля.');
  return {
    id: String(data.id),
    name: String(data.name || data.code || 'DonationAlerts').slice(0, 64),
    code: /^[A-Za-z0-9_.-]{1,64}$/.test(String(data.code || '')) ? String(data.code) : '',
    avatar: /^https:\/\//.test(String(data.avatar || '')) ? String(data.avatar) : '',
    socketToken: String(data.socket_connection_token)
  };
}

/** Обмен кода или refresh-токена на access-токен (нужен Client Secret приложения). */
export async function requestToken(values, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://www.donationalerts.com/oauth/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
    body: new URLSearchParams(values)
  });
  const text = String(await response.text());
  let data = null;
  try { data = JSON.parse(text); } catch { /* не JSON */ }
  if (!response.ok || !data?.access_token) {
    const reason = data?.error_description || data?.message || data?.error || text.slice(0, 160);
    throw new HttpError(response.status, `DonationAlerts отклонил вход (HTTP ${response.status}): ${reason}`);
  }
  const seconds = Number(data.expires_in);
  return {
    token: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : null
  };
}

/**
 * Вход через браузер. С Client Secret — Authorization Code (как в 0.4.0, с автообновлением токена),
 * без секрета — Implicit Grant (токен сразу во фрагменте адреса).
 */
export class OAuthFlow {
  constructor({now = Date.now} = {}) { this.now = now; this.pending = null; }

  begin(clientId = DEFAULT_CLIENT_ID, {code = false} = {}) {
    const state = randomBytes(24).toString('hex');
    this.pending = {state, created: this.now(), mode: code ? 'code' : 'token'};
    return 'https://www.donationalerts.com/oauth/authorize?' + new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT_URI, response_type: code ? 'code' : 'token', scope: SCOPES, state
    });
  }

  consume(body) {
    const pending = this.pending;
    if (body?.error) {
      this.pending = null;
      const details = body.error_description ? `: ${String(body.error_description).slice(0, 200)}` : '';
      throw new Error(body.error === 'access_denied' ? 'Вход отменён в DonationAlerts.' : `DonationAlerts вернул ошибку «${String(body.error).slice(0, 60)}»${details}`);
    }
    const supplied = Buffer.from(typeof body?.state === 'string' ? body.state : '');
    const expected = Buffer.from(pending?.state || '');
    if (!pending || this.now() - pending.created > 10 * 60_000 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new Error('Ссылка входа устарела. Нажмите «Войти через DonationAlerts» ещё раз.');
    this.pending = null;
    if (pending.mode === 'code') {
      if (typeof body.code !== 'string' || body.code.length < 8 || body.code.length > 4096) throw new Error('DonationAlerts не вернул код входа.');
      return {code: body.code};
    }
    const token = body.access_token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 12000 || /\s/.test(token))
      throw new Error('DonationAlerts не вернул токен.');
    const seconds = Number(body.expires_in);
    const expiresAt = Number.isSafeInteger(seconds) && seconds > 0 ? this.now() + seconds * 1000 : null;
    return {token, expiresAt};
  }
}

/**
 * Запасной канал: опрос списка донатов (GET /alerts/donations) каждые несколько секунд.
 * Первый опрос запоминает последний ID — старые донаты не выполняются. Дубли с WebSocket отсекает журнал ID.
 */
export class DonationPoller {
  constructor({getToken, onDonation, onStatus = () => {}, api = createApi(), intervalMs = 5000, log = () => {}}) {
    Object.assign(this, {getToken, onDonation, onStatus, api, intervalMs, log});
    this.running = false;
    this.baseline = null;
    this.state = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.baseline = null;
    this.#tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.#status({state: 'off'});
  }

  #status(status) {
    if (this.state === status.state && status.state !== 'error') return;
    this.state = status.state;
    this.onStatus(status);
  }

  async #tick() {
    let delay = this.intervalMs;
    try {
      const token = await this.getToken();
      const reply = await this.api('/alerts/donations', token);
      if (!this.running) return;
      const list = (Array.isArray(reply?.data) ? reply.data : []).filter(item => Number.isSafeInteger(Number(item?.id)));
      const ids = list.map(item => Number(item.id));
      if (this.baseline === null) {
        this.baseline = ids.length ? Math.max(...ids) : 0;
        this.log(`опрос донатов работает (каждые ${this.intervalMs / 1000} с)`);
      } else {
        const fresh = list.filter(item => Number(item.id) > this.baseline).sort((a, b) => Number(a.id) - Number(b.id));
        if (ids.length) this.baseline = Math.max(this.baseline, ...ids);
        for (const item of fresh) {
          this.log(`опрос: новый донат ${item.id}`);
          await this.onDonation(item);
        }
      }
      this.#status({state: 'ok'});
    } catch (error) {
      if (/scope/i.test(error?.message || '')) {
        if (this.state !== 'scope') this.log('опрос недоступен: у токена нет разрешения oauth-donation-index — нужен повторный вход');
        this.#status({state: 'scope', message: 'Нужно новое разрешение: нажмите «Выйти и войти заново».'});
        delay = 60_000;
      } else {
        this.#status({state: 'error', message: error?.message || String(error)});
        delay = Math.min(30_000, this.intervalMs * 3);
      }
    }
    if (this.running) {
      this.timer = setTimeout(() => this.#tick(), delay);
      this.timer.unref?.();
    }
  }
}

/** «3002: invalid token» — код и причина закрытия WebSocket понятным текстом. */
export function closeReason(event) {
  const code = event?.code ?? '?';
  let reason = String(event?.reason || '');
  try { reason = JSON.parse(reason).reason || reason; } catch { /* причина не JSON */ }
  const known = {1006: 'связь оборвалась', 3001: 'отключено сервером', 3002: 'неверный токен соединения', 3003: 'неверный запрос',
    3005: 'срок соединения истёк', 3010: 'неверный токен канала', 3011: 'слишком много подключений'};
  return `код ${code}${reason ? `: ${reason}` : known[code] ? `: ${known[code]}` : ''}`;
}

/**
 * Поток донатов через Centrifugo (протокол v2, который использует DonationAlerts).
 * Донат приходит как push без id: {"result":{"channel":"$alerts:donation_<id>","data":{"seq":1,"data":{...}}}}.
 */
export class DonationStream {
  constructor({getToken, onDonation, onStatus = () => {}, onProfile = () => {}, api = createApi(),
    websocketFactory = url => new WebSocket(url), pingMs = 25_000, refreshToken = null, log = () => {}}) {
    Object.assign(this, {getToken, onDonation, onStatus, onProfile, api, websocketFactory, pingMs, refreshToken, log});
    this.refreshTried = false;
    this.online = false;
    this.running = false;
    this.attempt = 0;
    this.delay = 2000;
    this.ws = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.delay = 2000;
    this.#connect();
  }

  stop(status = {state: 'off'}) {
    this.running = false;
    this.attempt++;
    this.#teardown();
    this.onStatus(status);
  }

  #teardown() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.renewTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) try { ws.close(); } catch { /* уже закрыт */ }
  }

  async #connect() {
    const attempt = ++this.attempt;
    this.onStatus({state: 'connecting'});
    try {
      const token = await this.getToken();
      const profile = await fetchProfile(this.api, token);
      if (!this.running || attempt !== this.attempt) return;
      this.log(`профиль получен (id ${profile.id}), открываю WebSocket`);
      this.onProfile(profile);
      const channel = `$alerts:donation_${profile.id}`;
      const ws = this.websocketFactory(CENTRIFUGO);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.log('WebSocket открыт, отправляю connect');
        if (this.ws === ws) ws.send(JSON.stringify({params: {token: profile.socketToken}, id: 1}));
      });
      ws.addEventListener('message', event => {
        if (this.ws !== ws) return;
        for (const line of String(event.data).split('\n')) {
          if (!line.trim()) continue;
          let packet;
          try { packet = JSON.parse(line); } catch { continue; }
          this.handle(packet, {ws, token, channel}).catch(error => this.#fail(error, attempt));
        }
      });
      ws.addEventListener('close', event => {
        const reason = closeReason(event);
        this.log(`WebSocket закрыт: ${reason}`);
        if (this.ws === ws) this.#fail(Object.assign(new Error(`Соединение с DonationAlerts закрыто (${reason}).`), {closed: true}), attempt);
      });
      ws.addEventListener('error', event => {
        this.log(`ошибка WebSocket: ${event?.message || event?.error?.message || 'без описания'}`);
        if (this.ws === ws) this.#fail(new Error('Ошибка соединения с DonationAlerts.'), attempt);
      });
    } catch (error) {
      this.#fail(error, attempt);
    }
  }

  #fail(error, attempt) {
    if (!this.running || attempt !== this.attempt) return;
    if (error?.status === 401 || error?.status === 403) {
      if (this.refreshToken && !this.refreshTried) {
        this.refreshTried = true;
        this.attempt++;
        this.#teardown();
        this.refreshToken()
          .then(ok => { if (ok && this.running) this.#connect(); else if (this.running) this.stop({state: 'auth', message: 'Сессия DonationAlerts закончилась. Войдите ещё раз.'}); })
          .catch(refreshError => { if (this.running) this.stop({state: 'auth', message: refreshError.message}); });
        return;
      }
      this.stop({state: 'auth', message: 'Сессия DonationAlerts закончилась. Войдите ещё раз.'});
      return;
    }
    this.log(`сбой: ${error?.message || error}`);
    this.attempt++;
    this.#teardown();
    // Обрыв уже работавшего соединения — тихо переподключаемся за секунду.
    const wasOnline = this.renewing || (this.online && Date.now() - this.onlineSince > 10_000);
    this.online = false;
    this.renewing = false;
    const delay = wasOnline ? 1000 : this.delay;
    this.onStatus(wasOnline
      ? {state: 'connecting', message: 'Переподключение…'}
      : {state: 'error', message: error?.message || String(error)});
    this.retryTimer = setTimeout(() => { if (this.running) this.#connect(); }, delay);
    this.retryTimer.unref?.();
    if (!wasOnline) this.delay = Math.min(this.delay * 2, 30_000);
  }

  async handle(packet, {ws, token, channel}) {
    if (!packet || typeof packet !== 'object' || this.ws !== ws) return;
    if (Object.keys(packet).length === 0) { ws.send('{}'); return; } // ping новых версий Centrifugo
    if (packet.error) {
      this.log(`ошибка Centrifugo в ответе id=${packet.id}: ${JSON.stringify(packet.error)}`);
      throw new Error('Centrifugo: ' + (packet.error.message || JSON.stringify(packet.error)));
    }
    if (packet.id === 1 && packet.result?.client) {
      const {expires, ttl} = packet.result;
      this.log(`connect принят (версия ${packet.result.version || '?'}${expires ? `, срок ${ttl} c` : ''}), запрашиваю подписку`);
      // Соединение со сроком действия: Centrifugo закроет его, если вовремя не продлить — продлеваем заранее.
      if (expires && Number(ttl) > 0) {
        clearTimeout(this.renewTimer);
        this.renewTimer = setTimeout(() => {
          if (this.ws !== ws) return;
          this.log('срок соединения подходит к концу — переподключаюсь заранее');
          this.renewing = true;
          this.#fail(new Error('Продление соединения.'), this.attempt);
        }, Math.max(5, Number(ttl) - 30) * 1000);
        this.renewTimer.unref?.();
      }
      const reply = await this.api('/centrifuge/subscribe', token, {method: 'POST', body: {channels: [channel], client: packet.result.client}});
      if (this.ws !== ws) return;
      const channelToken = reply?.channels?.find(item => item.channel === channel)?.token;
      if (!channelToken) throw new Error('DonationAlerts не выдал доступ к каналу донатов.');
      this.log('токен канала получен, подписываюсь');
      ws.send(JSON.stringify({params: {channel, token: channelToken}, method: 1, id: 2}));
      return;
    }
    if (packet.id === 2) {
      this.log('подписка на донаты активна');
      this.delay = 2000;
      this.refreshTried = false;
      this.online = true;
      this.onlineSince = Date.now();
      this.onStatus({state: 'online'});
      this.#startPing(ws);
      return;
    }
    if (packet.id) return; // ответы на ping
    const push = packet.result;
    if (push?.channel === channel && (push.type === undefined || push.type === 0) && push.data) {
      this.log('получен донат');
      await this.onDonation(push.data.data ?? push.data);
      return;
    }
    if (push?.type === 7 || push?.type === 'disconnect') this.log(`сервер просит отключиться: ${JSON.stringify(push.data ?? push)}`);
    if (packet.push?.channel === channel && packet.push.pub?.data) await this.onDonation(packet.push.pub.data);
  }

  #startPing(ws) {
    clearInterval(this.pingTimer);
    let id = 10;
    this.pingTimer = setInterval(() => {
      if (this.ws === ws) try { ws.send(JSON.stringify({id: id++, method: 7})); } catch { /* закроется само */ }
    }, this.pingMs);
    this.pingTimer.unref?.();
  }
}
