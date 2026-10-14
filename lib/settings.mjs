import {EFFECTS, CODES, effectByCode} from './catalog.mjs';

export const CURRENCIES = Object.freeze(['RUB', 'USD', 'EUR', 'UAH', 'KZT', 'BYN', 'PLN', 'TRY', 'BRL']);
// Примерный курс к рублю — только для первоначального пересчёта цен; курс можно поправить в настройках.
export const RUB_RATES = Object.freeze({RUB: 1, USD: 90, EUR: 98, UAH: 2.2, KZT: 0.18, BYN: 28, PLN: 23, TRY: 2.6, BRL: 16});

/** Курс по умолчанию: сколько единиц основной валюты стоит 1 единица currency. */
export const defaultRate = (currency, main) => Math.round((RUB_RATES[currency] / RUB_RATES[main]) * 10000) / 10000;

/** Цена в дополнительной валюте по курсу: крупные суммы — целыми, мелкие — до копеек. */
export function convertPrice(mainPrice, rate) {
  const value = mainPrice / rate;
  if (value >= 100) return Math.max(1, Math.round(value));
  return Math.max(0.01, Math.round(value * 100) / 100);
}
export const OVERLAY_POSITIONS = Object.freeze(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
export const PLAYER_RE = /^[A-Za-z0-9_]{3,16}$/;
export const CUSTOM_RE = /^c_[a-z0-9]{4,12}$/;
export const MAX_CUSTOM_EVENTS = 60;
export const MAX_COMMANDS = 10;

export function defaultSettings() {
  return {
    currency: 'RUB',
    // Дополнительные валюты: {USD: {rate: 90}} — 1 USD = 90 основной валюты. Цены событий в них — events[code].prices.
    extraCurrencies: {},
    codeTrigger: true,
    paused: false,
    // Встроенные события: цена, включение и необязательные name/icon/desc (переименование).
    events: Object.fromEntries(EFFECTS.map(effect => [effect.code, {price: effect.price, enabled: true}])),
    // Свои события: {code: {name, icon, desc, commands}}; цена и включение — в events[code].
    customEvents: {},
    minecraft: {mode: 'local', host: '127.0.0.1', port: 25575, player: '', simulate: false},
    overlay: {color: '#e8263a', duration: 6, position: 'bottom-left', showAmount: true},
    daClientId: ''
  };
}

const fail = message => { throw new Error(message); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function validPrice(value, min = 1) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < min || price > 10_000_000) fail(`Цена должна быть от ${min} до 10 000 000.`);
  return Math.round(price * 100) / 100;
}

function patchExtraCurrencies(settings, patch) {
  if (!isObject(patch)) fail('Неверный формат валют.');
  for (const [currency, change] of Object.entries(patch)) {
    if (!CURRENCIES.includes(currency)) fail(`Неизвестная валюта: ${currency}.`);
    if (change === null) { delete settings.extraCurrencies[currency]; continue; }
    if (currency === settings.currency) fail('Это уже основная валюта.');
    if (!isObject(change)) fail('Неверный формат валюты.');
    const rate = change.rate === undefined ? defaultRate(currency, settings.currency) : Number(change.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) fail(`Курс ${currency}: положительное число.`);
    settings.extraCurrencies[currency] = {rate: Math.round(rate * 10000) / 10000};
  }
}

/**
 * В events[code].prices хранятся только ручные цены в доп. валютах; остальные считаются по курсу (priceIn).
 * Убираем цены валют, которых больше нет; resetAll — вернуть все цены к расчёту по курсу.
 */
function syncPrices(settings, resetAll = false) {
  delete settings.extraCurrencies[settings.currency];
  for (const config of Object.values(settings.events)) {
    if (!isObject(config.prices) || resetAll) { delete config.prices; continue; }
    for (const currency of Object.keys(config.prices)) if (!settings.extraCurrencies[currency]) delete config.prices[currency];
    if (!Object.keys(config.prices).length) delete config.prices;
  }
}

/** Цена события в валюте: основная — как есть, дополнительная — ручная или по курсу; null — валюта не принимается. */
export function priceIn(settings, code, currency) {
  const config = settings.events[code];
  if (!config) return null;
  if (currency === settings.currency) return config.price;
  const extra = settings.extraCurrencies[currency];
  if (!extra) return null;
  return config.prices?.[currency] ?? convertPrice(config.price, extra.rate);
}

function validBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`Некорректное значение: ${label}.`);
  return value;
}

const cleanText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f§]/g, '').replace(/\s+/g, ' ').trim();

function validName(value) {
  const name = cleanText(value);
  if (!name || name.length > 40) fail('Название события: от 1 до 40 символов.');
  return name;
}

function validIcon(value) {
  const icon = cleanText(value);
  if (!icon || [...icon].length > 4) fail('Иконка: один эмодзи (до 4 символов).');
  return icon;
}

function validDesc(value) {
  const desc = cleanText(value);
  if (desc.length > 120) fail('Описание: не длиннее 120 символов.');
  return desc;
}

/** Команды своего события: по одной в строке, без «/», до 10 штук по 500 символов. */
export function validCommands(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split('\n'))
    .map(line => String(line).replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\/+/, ''))
    .filter(Boolean);
  if (!list.length) fail('Добавьте хотя бы одну команду Minecraft.');
  if (list.length > MAX_COMMANDS) fail(`Не больше ${MAX_COMMANDS} команд в одном событии.`);
  for (const command of list) if (command.length > 500) fail('Команда длиннее 500 символов.');
  return list;
}

const isKnown = (settings, code) => !!effectByCode(code) || !!settings.customEvents[code];

function patchCustomEvents(settings, patch) {
  if (!isObject(patch)) fail('Неверный формат своих событий.');
  for (const [code, change] of Object.entries(patch)) {
    if (!CUSTOM_RE.test(code)) fail('Неверный код своего события.');
    if (change === null) {
      delete settings.customEvents[code];
      delete settings.events[code];
      continue;
    }
    if (!isObject(change)) fail('Неверный формат события.');
    const existing = settings.customEvents[code];
    if (!existing && Object.keys(settings.customEvents).length >= MAX_CUSTOM_EVENTS) fail(`Не больше ${MAX_CUSTOM_EVENTS} своих событий.`);
    settings.customEvents[code] = {
      name: 'name' in change || !existing ? validName(change.name) : existing.name,
      icon: 'icon' in change || !existing ? validIcon(change.icon ?? '✨') : existing.icon,
      desc: 'desc' in change ? validDesc(change.desc) : existing?.desc ?? '',
      commands: 'commands' in change || !existing ? validCommands(change.commands) : existing.commands
    };
    settings.events[code] ??= {price: 100, enabled: true};
  }
}

function patchEvents(settings, patch) {
  if (!isObject(patch)) fail('Неверный формат списка событий.');
  for (const [code, change] of Object.entries(patch)) {
    if (!isKnown(settings, code)) fail(`Неизвестное событие: ${code}.`);
    if (!isObject(change)) fail('Неверный формат события.');
    const target = settings.events[code];
    if ('price' in change) target.price = validPrice(change.price);
    if ('prices' in change) {
      if (!isObject(change.prices)) fail('Неверный формат цен в валютах.');
      target.prices = isObject(target.prices) ? target.prices : {};
      for (const [currency, value] of Object.entries(change.prices)) {
        const extra = settings.extraCurrencies[currency];
        if (!extra) fail(`Валюта ${currency} не добавлена.`);
        const price = value === null || value === '' ? null : validPrice(value, 0.01);
        // Совпадает с расчётом по курсу (или пусто) — храним как «по курсу», чтобы цена следовала за основной.
        if (price === null || price === convertPrice(target.price, extra.rate)) delete target.prices[currency];
        else target.prices[currency] = price;
      }
      if (!Object.keys(target.prices).length) delete target.prices;
    }
    if ('enabled' in change) target.enabled = validBoolean(change.enabled, 'включение события');
    if (effectByCode(code)) {
      // Переименование встроенного события; reset — вернуть исходные название, иконку и описание.
      if (change.reset) { delete target.name; delete target.icon; delete target.desc; }
      if ('name' in change) target.name = validName(change.name);
      if ('icon' in change) target.icon = validIcon(change.icon);
      if ('desc' in change) target.desc = validDesc(change.desc);
    }
  }
}

function patchMinecraft(target, patch) {
  if (!isObject(patch)) fail('Неверные настройки Minecraft.');
  if ('mode' in patch) {
    if (!['local', 'rcon'].includes(patch.mode)) fail('Неизвестный режим подключения к Minecraft.');
    target.mode = patch.mode;
  }
  if ('host' in patch) {
    const host = String(patch.host).trim();
    if (!/^[A-Za-z0-9.\-:[\]]{1,253}$/.test(host)) fail('Адрес сервера: только IP или имя хоста, без http://.');
    target.host = host;
  }
  if ('port' in patch) {
    const port = Number(patch.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Порт RCON должен быть от 1 до 65535.');
    target.port = port;
  }
  if ('player' in patch) {
    const player = String(patch.player).trim();
    if (player && !PLAYER_RE.test(player)) fail('Ник: 3–16 латинских букв, цифр или _.');
    target.player = player;
  }
  if ('simulate' in patch) target.simulate = validBoolean(patch.simulate, 'режим симуляции');
}

function patchOverlay(target, patch) {
  if (!isObject(patch)) fail('Неверные настройки оверлея.');
  if ('color' in patch) {
    if (!/^#[0-9a-f]{6}$/i.test(String(patch.color))) fail('Цвет оверлея должен быть в формате #RRGGBB.');
    target.color = String(patch.color).toLowerCase();
  }
  if ('duration' in patch) {
    const duration = Number(patch.duration);
    if (!Number.isInteger(duration) || duration < 2 || duration > 30) fail('Длительность показа: от 2 до 30 секунд.');
    target.duration = duration;
  }
  if ('position' in patch) {
    if (!OVERLAY_POSITIONS.includes(patch.position)) fail('Неизвестное расположение оверлея.');
    target.position = patch.position;
  }
  if ('showAmount' in patch) target.showAmount = validBoolean(patch.showAmount, 'показ суммы');
}

/** Строгое применение изменений из интерфейса. Возвращает новый объект, исходный не меняется. */
export function applyPatch(current, patch) {
  if (!isObject(patch)) fail('Неверный формат настроек.');
  const next = structuredClone(current);
  if ('currency' in patch) {
    if (!CURRENCIES.includes(patch.currency)) fail('Неизвестная валюта.');
    if (patch.currency !== next.currency) {
      next.currency = patch.currency;
      delete next.extraCurrencies[patch.currency];
      // Курсы задаются к основной валюте — после её смены берём примерные заново.
      for (const currency of Object.keys(next.extraCurrencies)) next.extraCurrencies[currency] = {rate: defaultRate(currency, patch.currency)};
    }
  }
  if ('extraCurrencies' in patch) patchExtraCurrencies(next, patch.extraCurrencies);
  if ('codeTrigger' in patch) next.codeTrigger = validBoolean(patch.codeTrigger, 'коды в сообщении');
  if ('paused' in patch) next.paused = validBoolean(patch.paused, 'пауза');
  if ('customEvents' in patch) patchCustomEvents(next, patch.customEvents);
  if ('events' in patch) patchEvents(next, patch.events);
  syncPrices(next, patch.recalcPrices === true);
  if ('minecraft' in patch) patchMinecraft(next.minecraft, patch.minecraft);
  if ('overlay' in patch) patchOverlay(next.overlay, patch.overlay);
  if ('daClientId' in patch) {
    const id = String(patch.daClientId ?? '').trim();
    if (id && !/^\d{1,12}$/.test(id)) fail('Client ID DonationAlerts состоит из цифр.');
    next.daClientId = id;
  }
  return next;
}

/** Все события с учётом переименований и своих событий — в порядке каталога, свои в конце. */
export function effectiveEvents(settings) {
  // prices — цены во всех доп. валютах; manual — какие из них заданы вручную.
  const pricesOf = code => Object.fromEntries(Object.keys(settings.extraCurrencies).map(currency => [currency, priceIn(settings, code, currency)]));
  const manualOf = code => Object.keys(settings.events[code]?.prices || {});
  const builtIn = EFFECTS.map(effect => {
    const config = settings.events[effect.code];
    return {...effect, name: config.name || effect.name, icon: config.icon || effect.icon, desc: config.desc ?? effect.desc,
      price: config.price, prices: pricesOf(effect.code), manual: manualOf(effect.code), enabled: config.enabled, custom: false, renamed: !!(config.name || config.icon || config.desc != null),
      original: {name: effect.name, icon: effect.icon, desc: effect.desc}};
  });
  const custom = Object.entries(settings.customEvents).map(([code, item]) => ({
    code, name: item.name, icon: item.icon, desc: item.desc, category: 'custom', commands: item.commands,
    price: settings.events[code]?.price ?? 100, prices: pricesOf(code), manual: manualOf(code),
    enabled: settings.events[code]?.enabled ?? true, custom: true
  }));
  return [...builtIn, ...custom];
}

/** Мягкая загрузка с диска: повреждённые разделы заменяются значениями по умолчанию. */
export function loadSettings(raw) {
  let settings = defaultSettings();
  if (!isObject(raw)) return settings;
  for (const key of ['currency', 'extraCurrencies', 'codeTrigger', 'paused', 'minecraft', 'overlay', 'daClientId']) {
    if (key in raw) try { settings = applyPatch(settings, {[key]: raw[key]}); } catch { /* значение по умолчанию */ }
  }
  if (settings.overlay.color === '#8b2cff') settings.overlay.color = '#e8263a'; // старый фиолетовый -> новый красный
  if (isObject(raw.customEvents)) {
    for (const [code, item] of Object.entries(raw.customEvents)) {
      try { settings = applyPatch(settings, {customEvents: {[code]: item}}); } catch { /* пропускаем повреждённое */ }
    }
  }
  if (isObject(raw.events)) {
    for (const code of [...CODES, ...Object.keys(settings.customEvents)]) {
      if (isObject(raw.events[code])) try { settings = applyPatch(settings, {events: {[code]: raw.events[code]}}); } catch { /* по умолчанию */ }
    }
  }
  return settings;
}
