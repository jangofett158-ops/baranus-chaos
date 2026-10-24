import {EFFECTS, CODES, MOD_CODES, DEFAULT_TARGET, effectByCode} from './catalog.mjs';

export const CURRENCIES = Object.freeze(['RUB', 'USD', 'EUR']);
// Валюты с копейками (центами): цены в них — до 0,01. Рубли — только целыми.
export const FRACTIONAL = Object.freeze(['USD', 'EUR']);
// Примерный курс к рублю — только для первоначального пересчёта цен, потом курс подтягивается из интернета.
export const RUB_RATES = Object.freeze({RUB: 1, USD: 90, EUR: 98});

/** Курс по умолчанию: сколько единиц основной валюты стоит 1 единица currency. */
export const defaultRate = (currency, main) => Math.round((RUB_RATES[currency] / RUB_RATES[main]) * 10000) / 10000;

/**
 * Цена в дополнительной валюте по курсу. Доллары и евро — вверх до цента (49 ₽ → 0,55 $);
 * рубли — вверх до числа, оканчивающегося на 0 или 5 (27 → 30), минимум 5.
 */
export function convertPrice(mainPrice, rate, currency) {
  if (FRACTIONAL.includes(currency)) return Math.max(0.01, Math.ceil(mainPrice / rate * 100 - 1e-6) / 100);
  return Math.max(5, Math.ceil(mainPrice / rate / 5 - 1e-9) * 5);
}
export const OVERLAY_POSITIONS = Object.freeze(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
export const PLAYER_RE = /^[A-Za-z0-9_]{3,16}$/;
export const CUSTOM_RE = /^c_[a-z0-9]{4,12}$/;
export const MAX_CUSTOM_EVENTS = 60;
export const MAX_COMMANDS = 10;
export const SCRIPT_FORMAT = 2;

export function defaultSettings() {
  return {
    currency: 'RUB',
    // Дополнительные валюты: {USD: {rate: 90}} — 1 USD = 90 основной валюты. Цены событий в них — events[code].prices.
    extraCurrencies: {},
    paused: false,
    // Очередь: событие срабатывает через delay секунд после доната, каждое следующее — ещё на delay секунд позже.
    queue: {delay: 30},
    // Встроенные события: цена, включение и необязательные name/icon/desc (переименование).
    events: Object.fromEntries(EFFECTS.map(effect => [effect.code, {price: effect.price, enabled: true}])),
    // Свои события: {code: {name, icon, desc, commands, firstCommands?}}; цена и включение — в events[code].
    customEvents: {},
    // Формат скриптов: 2 — кому срабатывает, видно по самим командам ({player} / {player@a}).
    scriptFormat: SCRIPT_FORMAT,
    // mode: local — свой мир на этом ПК; friend — мир друга по сети (Radmin VPN); rcon — отдельный сервер.
    minecraft: {mode: 'local', host: '127.0.0.1', port: 25575, friendHost: '', player: '', simulate: false},
    overlay: {color: '#e8263a', duration: 6, position: 'bottom-left', showAmount: true},
    daClientId: ''
  };
}

const fail = message => { throw new Error(message); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Цена в валюте: рубли — целыми, доллары и евро — с копейками (до 0,01). */
export function validPrice(value, currency = 'RUB') {
  const price = Number(value);
  if (FRACTIONAL.includes(currency)) {
    if (!Number.isFinite(price) || price < 0.005 || price > 10_000_000) fail(`Цена в ${currency} - от 0,01 до 10 000 000.`);
    return Math.round(price * 100) / 100;
  }
  if (!Number.isFinite(price) || Math.round(price) < 1 || price > 10_000_000) fail('Цена - целое число от 1 до 10 000 000.');
  return Math.round(price);
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
  return config.prices?.[currency] ?? convertPrice(config.price, extra.rate, currency);
}

function validBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`Некорректное значение: ${label}.`);
  return value;
}

const cleanText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f§]/g, '').replace(/\s+/g, ' ').trim();

function validName(value) {
  const name = cleanText(value);
  if (!name || name.length > 40) fail('Название ивента: от 1 до 40 символов.');
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
  if (list.length > MAX_COMMANDS) fail(`Не больше ${MAX_COMMANDS} команд в одном ивенте.`);
  for (const command of list) if (command.length > 500) fail('Команда длиннее 500 символов.');
  return list;
}

const isKnown = (settings, code) => !!effectByCode(code) || !!settings.customEvents[code];

/**
 * Скрипт встроенного ивента по умолчанию: одна команда мода с его действием. Его можно дополнить или заменить
 * своими командами; пока скрипт не меняли, ивент выполняется действием мода напрямую.
 */
export const defaultScript = code => MOD_CODES.includes(code)
  ? [`baranuschaos run ${code} ${DEFAULT_TARGET[code] === 'all' ? '{player@a}' : '{player}'} {donor}`] : [];

/** Команды для первого доната (необязательно): пусто — ивент всегда выполняет обычные команды. */
function validFirstCommands(value) {
  const empty = value == null || (Array.isArray(value) ? !value.length : !String(value).trim());
  return empty ? null : validCommands(value);
}

const PREFIX_RE = /^\s*(всем|all|получателю|receiver)\s*:\s*/iu;

/**
 * Скрипт прежнего формата (до 1.7.1: «Кому срабатывает» и приставки «всем:»/«получателю:») — в новый:
 * у строк «всем» {player} становится {player@a}. all — было ли выбрано «Всем игрокам».
 */
export function migrateLines(lines, all) {
  const list = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  return list.map(line => {
    const text = String(line);
    const match = text.match(PREFIX_RE);
    const lineAll = match ? /^(всем|all)$/iu.test(match[1]) : all;
    const rest = match ? text.slice(match[0].length) : text;
    return lineAll ? rest.replaceAll('{player}', '{player@a}') : rest;
  });
}

/** Перевести ивенты прежнего формата (raw.events / raw.customEvents) на {player@a}; без target. */
function migrateRaw(raw) {
  const events = isObject(raw.events) ? structuredClone(raw.events) : raw.events;
  const customEvents = isObject(raw.customEvents) ? structuredClone(raw.customEvents) : raw.customEvents;
  const targetOf = (code, fallback) => (isObject(events?.[code]) && events[code].target) || fallback;
  if (isObject(customEvents)) {
    for (const [code, item] of Object.entries(customEvents)) {
      if (!isObject(item)) continue;
      const all = targetOf(code, 'receiver') === 'all';
      if (item.commands !== undefined) item.commands = migrateLines(item.commands, all);
      if (item.firstCommands !== undefined) item.firstCommands = migrateLines(item.firstCommands, all);
    }
  }
  if (isObject(events)) {
    for (const [code, event] of Object.entries(events)) {
      if (!isObject(event)) continue;
      if (MOD_CODES.includes(code)) {
        const fallback = DEFAULT_TARGET[code] || 'receiver';
        const all = targetOf(code, fallback) === 'all';
        if (event.commands !== undefined) event.commands = migrateLines(event.commands, all);
        else if (all !== (fallback === 'all')) event.commands = [`baranuschaos run ${code} ${all ? '{player@a}' : '{player}'} {donor}`];
      }
      delete event.target;
    }
  }
  return {...raw, events, customEvents, scriptFormat: SCRIPT_FORMAT};
}

function patchCustomEvents(settings, patch) {
  if (!isObject(patch)) fail('Неверный формат своих ивентов.');
  for (const [code, change] of Object.entries(patch)) {
    if (!CUSTOM_RE.test(code)) fail('Неверный код своего ивента.');
    if (change === null) {
      delete settings.customEvents[code];
      delete settings.events[code];
      continue;
    }
    if (!isObject(change)) fail('Неверный формат ивента.');
    const existing = settings.customEvents[code];
    if (!existing && Object.keys(settings.customEvents).length >= MAX_CUSTOM_EVENTS) fail(`Не больше ${MAX_CUSTOM_EVENTS} своих ивентов.`);
    settings.customEvents[code] = {
      name: 'name' in change || !existing ? validName(change.name) : existing.name,
      icon: 'icon' in change || !existing ? validIcon(change.icon ?? '✨') : existing.icon,
      desc: 'desc' in change ? validDesc(change.desc) : existing?.desc ?? '',
      commands: 'commands' in change || !existing ? validCommands(change.commands) : existing.commands
    };
    const first = 'firstCommands' in change ? validFirstCommands(change.firstCommands) : existing?.firstCommands;
    if (first) settings.customEvents[code].firstCommands = first;
    settings.events[code] ??= {price: 100, enabled: true};
  }
}

function patchEvents(settings, patch) {
  if (!isObject(patch)) fail('Неверный формат списка ивентов.');
  for (const [code, change] of Object.entries(patch)) {
    if (!isKnown(settings, code)) fail(`Неизвестный ивент: ${code}.`);
    if (!isObject(change)) fail('Неверный формат ивента.');
    const target = settings.events[code];
    if ('price' in change) target.price = validPrice(change.price, settings.currency);
    if ('prices' in change) {
      if (!isObject(change.prices)) fail('Неверный формат цен в валютах.');
      target.prices = isObject(target.prices) ? target.prices : {};
      for (const [currency, value] of Object.entries(change.prices)) {
        const extra = settings.extraCurrencies[currency];
        if (!extra) fail(`Валюта ${currency} не добавлена.`);
        const price = value === null || value === '' ? null : validPrice(value, currency);
        // Совпадает с расчётом по курсу (или пусто) — храним как «по курсу», чтобы цена следовала за основной.
        if (price === null || price === convertPrice(target.price, extra.rate, currency)) delete target.prices[currency];
        else target.prices[currency] = price;
      }
      if (!Object.keys(target.prices).length) delete target.prices;
    }
    if ('enabled' in change) target.enabled = validBoolean(change.enabled, 'включение ивента');
    // Перезарядки, силы/количества и «Кому срабатывает» в настройках больше нет: старые значения отбрасываются
    // (кому - теперь видно по командам: {player} или {player@a}).
    for (const key of ['cooldown', 'count', 'seconds', 'level', 'target']) delete target[key];
    if (effectByCode(code)) {
      // Переименование встроенного события; reset — вернуть исходные название, иконку и описание.
      if (change.reset) { delete target.name; delete target.icon; delete target.desc; delete target.commands; delete target.firstCommands; }
      if ('name' in change) target.name = validName(change.name);
      if ('icon' in change) target.icon = validIcon(change.icon);
      if ('desc' in change) target.desc = validDesc(change.desc);
      if ('commands' in change) {
        if (!MOD_CODES.includes(code)) fail('У случайного ивента нет команд: он запускает один из включённых.');
        const raw = change.commands;
        const empty = raw == null || (Array.isArray(raw) ? !raw.length : !String(raw).trim());
        const list = empty ? null : validCommands(raw);
        // Пусто или как по умолчанию - не храним: ивент выполняется действием мода.
        if (!list || stableJson(list) === stableJson(defaultScript(code))) delete target.commands;
        else target.commands = list;
      }
      if ('firstCommands' in change) {
        const first = validFirstCommands(change.firstCommands);
        if (first && !MOD_CODES.includes(code)) fail('У случайного ивента нет команд: он запускает один из включённых.');
        if (first) target.firstCommands = first; else delete target.firstCommands;
      }
    }
  }
}

function patchMinecraft(target, patch) {
  if (!isObject(patch)) fail('Неверные настройки Minecraft.');
  if ('mode' in patch) {
    if (!['local', 'friend', 'rcon'].includes(patch.mode)) fail('Неизвестный режим подключения к Minecraft.');
    target.mode = patch.mode;
  }
  if ('host' in patch) {
    const host = String(patch.host).trim();
    if (!/^[A-Za-z0-9.\-:[\]]{1,253}$/.test(host)) fail('Адрес сервера: только IP или имя хоста, без http://.');
    target.host = host;
  }
  if ('friendHost' in patch) {
    const host = String(patch.friendHost).trim();
    if (host && !/^[A-Za-z0-9.\-:[\]]{1,253}$/.test(host)) fail('Адрес друга: IP из Radmin VPN, например 26.12.34.56.');
    target.friendHost = host;
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
      // В рублях копеек нет — цены, заданные в долларах или евро, округляются до целых.
      if (!FRACTIONAL.includes(next.currency)) for (const config of Object.values(next.events)) config.price = Math.max(1, Math.round(config.price));
      delete next.extraCurrencies[patch.currency];
      // Курсы задаются к основной валюте — после её смены берём примерные заново.
      for (const currency of Object.keys(next.extraCurrencies)) next.extraCurrencies[currency] = {rate: defaultRate(currency, patch.currency)};
    }
  }
  if ('extraCurrencies' in patch) patchExtraCurrencies(next, patch.extraCurrencies);
  if ('queue' in patch) {
    if (!isObject(patch.queue)) fail('Неверные настройки очереди.');
    if ('delay' in patch.queue) {
      const value = Number(patch.queue.delay);
      if (!Number.isInteger(value) || value < 0 || value > 600) fail('Задержка - от 0 до 600 секунд.');
      next.queue = {delay: value};
    }
  }
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
  // Кому срабатывает - по командам: «all» - только {player@a}, «both» - и {player}, и {player@a}, иначе получателю.
  const targetOf = lines => {
    const text = lines.join('\n');
    const all = text.includes('{player@a}'), one = text.includes('{player}');
    return all ? (one ? 'both' : 'all') : 'receiver';
  };
  const builtIn = EFFECTS.map(effect => {
    const config = settings.events[effect.code];
    const commands = config.commands || defaultScript(effect.code);
    return {...effect, name: config.name || effect.name, icon: config.icon || effect.icon, desc: config.desc ?? effect.desc,
      price: config.price, prices: pricesOf(effect.code), manual: manualOf(effect.code), enabled: config.enabled, custom: false,
      commands, firstCommands: config.firstCommands || null, target: targetOf([...commands, ...(config.firstCommands || [])]),
      scripted: !!(config.commands || config.firstCommands),
      renamed: !!(config.name || config.icon || config.desc != null || config.commands || config.firstCommands),
      original: {name: effect.name, icon: effect.icon, desc: effect.desc}};
  });
  const custom = Object.entries(settings.customEvents).map(([code, item]) => ({
    code, name: item.name, icon: item.icon, desc: item.desc, category: 'custom', commands: item.commands,
    firstCommands: item.firstCommands || null, target: targetOf([...item.commands, ...(item.firstCommands || [])]),
    price: settings.events[code]?.price ?? 100, prices: pricesOf(code), manual: manualOf(code),
    enabled: settings.events[code]?.enabled ?? true, custom: true
  }));
  return [...builtIn, ...custom];
}

/** Мягкая загрузка с диска: повреждённые разделы заменяются значениями по умолчанию. */
export function loadSettings(raw) {
  let settings = defaultSettings();
  if (!isObject(raw)) return settings;
  if (raw.scriptFormat !== SCRIPT_FORMAT) raw = migrateRaw(raw);
  // Валют теперь только три: остальные из прежних версий (и цены в них) молча отбрасываются.
  const known = isObject(raw.extraCurrencies)
    ? Object.fromEntries(Object.entries(raw.extraCurrencies).filter(([code]) => CURRENCIES.includes(code)))
    : raw.extraCurrencies;
  for (const key of ['currency', 'extraCurrencies', 'paused', 'queue', 'minecraft', 'overlay', 'daClientId']) {
    const value = key === 'extraCurrencies' ? known : raw[key];
    if (key in raw) try { settings = applyPatch(settings, {[key]: value}); } catch { /* значение по умолчанию */ }
  }
  settings.minecraft.simulate = false; // переключателя симуляции больше нет — старое значение не должно «залипнуть»
  if (settings.overlay.color === '#8b2cff') settings.overlay.color = '#e8263a'; // старый фиолетовый -> новый красный
  if (isObject(raw.customEvents)) {
    for (const [code, item] of Object.entries(raw.customEvents)) {
      try { settings = applyPatch(settings, {customEvents: {[code]: item}}); } catch { /* пропускаем повреждённое */ }
    }
  }
  if (isObject(raw.events)) {
    for (const code of [...CODES, ...Object.keys(settings.customEvents)]) {
      if (!isObject(raw.events[code])) continue;
      const event = {...raw.events[code]};
      if (isObject(event.prices)) event.prices = Object.fromEntries(Object.entries(event.prices).filter(([code]) => settings.extraCurrencies[code]));
      try { settings = applyPatch(settings, {events: {[code]: event}}); } catch { /* по умолчанию */ }
    }
  }
  return settings;
}

/** Общие настройки, которые синхронизируются между приложениями двух стримеров через мир Minecraft. */
export const SHARED_KEYS = Object.freeze(['currency', 'extraCurrencies', 'queue', 'events', 'customEvents', 'scriptFormat']);

// ---------- Файл своих ивентов: обмен между стримерами ----------
export const IVENTS_FORMAT = 'baranus-chaos-ivents';

/**
 * Все ивенты для файла: встроенные (с кодом - при загрузке обновляются на месте) и свои.
 * У каждого - название, описание, скрипт, цены, кому срабатывает и включённость.
 */
export function exportIvents(settings) {
  const pricing = code => {
    const config = settings.events[code] || {};
    return {price: config.price, ...(config.prices ? {prices: config.prices} : {}), enabled: config.enabled ?? true};
  };
  const first = item => item.firstCommands ? {firstCommands: item.firstCommands} : {};
  const builtIn = effectiveEvents(settings).filter(item => !item.custom).map(item => ({
    code: item.code, name: item.name, desc: item.desc, ...(item.commands.length ? {commands: item.commands} : {}), ...first(item),
    ...pricing(item.code)
  }));
  const custom = Object.entries(settings.customEvents).map(([code, item]) => ({
    name: item.name, desc: item.desc, commands: item.commands, ...first(item), ...pricing(code)
  }));
  return {format: IVENTS_FORMAT, version: 3, currency: settings.currency, ivents: [...builtIn, ...custom]};
}

/**
 * Загрузить ивенты из файла. Встроенные (по коду) получают настройки из файла, свои - добавляются; свой ивент
 * с тем же названием и командами уже есть - пропускается. Каждый проверяется как в редакторе; ошибка в любом -
 * не меняется ничего. makeCode() - новый код своего ивента.
 */
export function importIvents(settings, file, makeCode) {
  if (!isObject(file) || file.format !== IVENTS_FORMAT || !Array.isArray(file.ivents)) fail('Это не файл ивентов Baranus Chaos.');
  if (!file.ivents.length) fail('В файле нет ивентов.');
  // Файл заменяет свои ивенты полностью: старые удаляются, из файла - добавляются. Совпавшие (то же название и команды)
  // сохраняют прежний код, чтобы история и очередь их узнавали.
  const keyOf = item => stableJson([item.name, item.commands]);
  const oldCodes = new Map(Object.entries(settings.customEvents).map(([code, item]) => [keyOf(item), code]));
  const removed = Object.keys(settings.customEvents).length;
  let next = removed ? applyPatch(settings, {customEvents: Object.fromEntries(Object.keys(settings.customEvents).map(code => [code, null]))}) : settings;
  let added = 0, updated = 0, skipped = 0;
  // Файлы до 1.7.1 (версия 2) - с «Кому срабатывает» и приставками: команды переводятся на {player@a}.
  const legacy = !(Number(file.version) >= 3);
  // Цены в доп. валютах - только для валют, которые включены здесь.
  const pricesOf = (raw, target) => isObject(raw.prices) ? Object.fromEntries(Object.entries(raw.prices).filter(([currency]) => target.extraCurrencies[currency])) : undefined;
  for (const raw of file.ivents) {
    const label = isObject(raw) && typeof raw.name === 'string' ? `«${raw.name.slice(0, 40)}»` : `№${added + updated + skipped + 1}`;
    try {
      if (!isObject(raw)) fail('неверный формат.');
      const effect = typeof raw.code === 'string' ? effectByCode(raw.code) : null;
      const all = (raw.target ?? (effect && DEFAULT_TARGET[effect.code]) ?? 'receiver') === 'all';
      const script = key => legacy && raw[key] !== undefined && raw[key] !== null ? migrateLines(raw[key], all) : raw[key];
      const commands = script('commands'), firstCommands = script('firstCommands');
      const scripts = {...(commands !== undefined ? {commands} : {}), ...(firstCommands !== undefined ? {firstCommands} : {})};
      if (effect) {
        // Встроенный: сначала исходное состояние, потом отличия из файла (название, описание, скрипт, цены...).
        const prices = pricesOf(raw, next);
        next = applyPatch(next, {events: {[effect.code]: {
          reset: true,
          ...(typeof raw.name === 'string' && raw.name.trim() !== effect.name ? {name: raw.name} : {}),
          ...(typeof raw.desc === 'string' && raw.desc.trim() !== effect.desc ? {desc: raw.desc} : {}),
          ...(MOD_CODES.includes(effect.code) ? scripts : {}),
          ...(raw.price !== undefined ? {price: raw.price} : {}), ...(prices ? {prices} : {}),
          ...(raw.enabled !== undefined ? {enabled: raw.enabled} : {})
        }}});
        updated++;
        continue;
      }
      const probe = applyPatch(next, {customEvents: {c_00000000: {name: raw.name, desc: raw.desc ?? '', ...scripts}}}).customEvents.c_00000000;
      // Один и тот же ивент дважды в файле - второй пропускаем.
      if (Object.values(next.customEvents).some(other => keyOf(other) === keyOf(probe))) {
        skipped++;
        continue;
      }
      const reused = oldCodes.get(keyOf(probe));
      const code = reused && !next.customEvents[reused] ? reused : makeCode();
      const candidate = applyPatch(next, {customEvents: {[code]: {name: raw.name, desc: raw.desc ?? '', ...scripts}}});
      const prices = pricesOf(raw, candidate);
      next = applyPatch(candidate, {events: {[code]: {
        ...(raw.price !== undefined ? {price: raw.price} : {}), ...(prices ? {prices} : {}),
        ...(raw.enabled !== undefined ? {enabled: raw.enabled} : {})
      }}});
      added++;
    } catch (error) {
      fail(`Ивент ${label}: ${error.message}`);
    }
  }
  return {settings: next, added, updated, skipped, removed, otherCurrency: typeof file.currency === 'string' && file.currency !== settings.currency ? file.currency : null};
}

export function exportShared(settings) {
  return Object.fromEntries(SHARED_KEYS.map(key => [key, settings[key]]));
}

/** JSON с упорядоченными ключами — для сравнения настроек. */
export function stableJson(value) {
  return JSON.stringify(value, (key, item) => isObject(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

const MERGED_BY_ENTRY = new Set(['events', 'customEvents', 'extraCurrencies']);

/** Слить правки двух приложений: base — общее состояние при последней синхронизации, local — свои настройки,
 *  remote — новее в мире. Что изменено здесь — берётся своё, остальное — из мира; события и валюты — по отдельности. */
export function mergeShared(base, local, remote) {
  if (!isObject(base) || !isObject(remote)) return local;
  const same = (a, b) => stableJson(a) === stableJson(b);
  const out = {};
  for (const key of SHARED_KEYS) {
    if (MERGED_BY_ENTRY.has(key)) {
      const b = base[key] || {}, l = local[key] || {}, r = remote[key] || {};
      out[key] = {};
      for (const code of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const pick = same(l[code], b[code]) ? r[code] : l[code];
        if (pick !== undefined) out[key][code] = pick;
      }
    } else {
      out[key] = same(local[key], base[key]) && key in remote ? remote[key] : local[key];
    }
  }
  return out;
}

/** Принять общие настройки из мира: личные (подключение, вход DonationAlerts, пауза) остаются свои. */
export function importShared(settings, shared) {
  if (!isObject(shared)) fail('Повреждённые общие настройки.');
  const picked = Object.fromEntries(SHARED_KEYS.filter(key => key in shared).map(key => [key, shared[key]]));
  // Настройки из мира от прежней версии (без scriptFormat) - тоже переводятся на новый формат скриптов.
  return loadSettings({...structuredClone(settings), ...picked, scriptFormat: shared.scriptFormat ?? 1});
}
