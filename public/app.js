const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const SYMBOL = {RUB: '₽', USD: '$', EUR: '€', UAH: '₴', KZT: '₸', BYN: 'Br', PLN: 'zł', TRY: '₺', BRL: 'R$'};
const CURRENCY_NAME = {RUB: 'Рубли', USD: 'Доллары', EUR: 'Евро', UAH: 'Гривны', KZT: 'Тенге', BYN: 'Бел. рубли', PLN: 'Злотые', TRY: 'Лиры', BRL: 'Реалы'};
const STATE_LABEL = {done: 'Выполнено', simulated: 'Симуляция', failed: 'Ошибка', skipped: 'Пауза', ignored: 'Без события'};
const KIND_LABEL = {test: 'Тест', 'test-donation': 'Тестовый донат', replay: 'Повтор'};

let S = null;
let filter = 'all';
let daWaiting = false;

// ---------- Утилиты ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

async function api(path, body = {}) {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Baranus': '1'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

function toast(text, kind = '') {
  const el = h('div', {class: `toast ${kind}`}, text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

const num = value => Number(value).toLocaleString('ru-RU', {maximumFractionDigits: 2});
const money = (amount, currency = S.settings.currency) => `${num(amount)} ${SYMBOL[currency] || currency}`;
const effectOf = code => S.catalog.find(effect => effect.code === code);
const priceOf = code => S.settings.events[code].price;
const cents = value => Math.round(Number(value) * 100);

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area = h('textarea', {style: 'position:fixed;opacity:0'}, text);
    document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast(done, 'ok');
}

function apply(state) {
  Object.assign(S, state);
  renderAll();
}

// ---------- Навигация ----------
function show(view) {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  try { localStorage.setItem('baranus-view', view); } catch { /* без памяти */ }
  if (S) renderStatus();
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-view], [data-goto]');
  if (target) show(target.dataset.view || target.dataset.goto);
});

// ---------- Статусы ----------
function setMini(selector, kind) {
  $(selector).className = `mini ${kind || ''}`;
}
function setCard(selector, kind, value, note) {
  const card = $(selector);
  card.className = `status-card ${kind || ''}`;
  card.querySelector('.value').textContent = value;
  card.title = note || ''; // пояснение — во всплывающей подсказке при наведении
}

function renderStatus() {
  const {da, mc, settings} = S;
  const local = settings.minecraft.mode === 'local';
  const player = mc.target;

  const daKind = {online: 'ok', connecting: 'warn', error: 'bad', auth: 'bad'}[da.state] || '';
  const daValue = da.state === 'online' ? (da.profile?.name || 'Подключено')
    : {connecting: 'Подключение…', error: 'Нет связи', auth: 'Нужен вход'}[da.state] || 'Не подключено';
  setMini('#mini-da', daKind);
  setCard('#card-da', daKind, daValue, da.state === 'online'
    ? (da.channel === 'polling' ? 'Донаты проверяются каждые 5 секунд' : 'Донаты приходят в реальном времени')
    : (da.message || 'Войдите через DonationAlerts'));

  const mcKind = {online: 'ok', simulate: 'sim', version: 'warn', error: 'bad'}[mc.state] || '';
  const mcValue = {online: `Мод ${mc.version}`, simulate: 'Симуляция', version: 'Другая версия мода', error: local ? 'Мир не запущен' : 'Нет связи'}[mc.state] || 'Не настроено';
  const mcNote = mc.state === 'online' ? `${mc.players.length} в игре · ${local ? 'локальный мир' : `${settings.minecraft.host}:${settings.minecraft.port}`}` : mc.message;
  setMini('#mini-mc', mcKind === 'sim' ? 'warn' : mcKind);
  setCard('#card-mc', mcKind, mcValue, mcNote);

  let playerKind = '', playerNote = 'Зайдите в мир — ник определится сам';
  if (player) {
    if (mc.state !== 'online') playerNote = 'Сервер пока не отвечает';
    else if (mc.paused) { playerKind = 'warn'; playerNote = 'Хаос на паузе в игре (клавиша K)'; }
    else if (mc.playerOnline) { playerKind = 'ok'; playerNote = 'В игре — события будут срабатывать'; }
    else { playerKind = 'bad'; playerNote = 'Не в сети'; }
  }
  setCard('#card-player', playerKind, player || 'Не выбран', playerNote);
  $('#resume-game').hidden = !(mc.state === 'online' && mc.paused);

  const toggle = $('#chaos-toggle');
  toggle.classList.toggle('paused', settings.paused);
  $('#chaos-title').textContent = settings.paused ? 'ХАОС НА ПАУЗЕ' : 'ХАОС ВКЛЮЧЁН';
  $('#chaos-sub').textContent = settings.paused ? 'Донаты не запускают события' : 'Нажмите, чтобы поставить паузу';

  const daDone = da.state === 'online';
  const mcDone = mc.state === 'online' && !!player;
  $('#nav-alert').hidden = daDone && mcDone;

  renderDaBox();
  renderMcResult();
  renderQueue();
  renderCoop();
}

function renderDaBox() {
  const {da} = S;
  const box = $('#da-box');
  if (da.state === 'online') daWaiting = false;
  if (da.state === 'online' && da.profile) {
    const avatar = da.profile.avatar
      ? h('img', {src: da.profile.avatar, alt: '', referrerpolicy: 'no-referrer'})
      : h('div', {class: 'avatar'}, da.profile.name.slice(0, 1).toUpperCase());
    box.replaceChildren(h('div', {class: 'da-profile'}, avatar,
      h('div', {class: 'who'}, h('b', {}, da.profile.name),
        h('small', {}, da.channel === 'polling' ? 'Подключено · донаты проверяются каждые 5 секунд' : 'Подключено · донаты в реальном времени')),
      h('button', {class: 'btn ghost small danger', type: 'button', onclick: logout}, 'Выйти')),
      da.channel === 'polling' ? h('p', {class: 'hint'}, da.message) : '',
      daLogBlock() || '');
    return;
  }
  if (da.hasToken) {
    // Вход выполнен, идёт (пере)подключение к потоку донатов.
    daWaiting = false;
    const connecting = da.state === 'connecting';
    box.replaceChildren(...[
      h('div', {class: 'da-wait'}, connecting ? h('span', {class: 'spinner'}) : h('span', {}, '⚠️'),
        connecting ? (da.message || 'Подключаемся к потоку донатов…') : 'Вход выполнен, но поток донатов не подключился'),
      !connecting && da.message ? h('p', {class: 'error-text'}, da.message) : null,
      h('div', {class: 'row'},
        h('button', {class: 'btn primary', type: 'button', onclick: reconnect}, '↻ Переподключить'),
        h('button', {class: 'btn ghost danger', type: 'button', onclick: logout}, 'Выйти и войти заново')),
      daLogBlock()
    ].filter(Boolean));
    return;
  }
  box.replaceChildren(...[
    daWaiting ? h('div', {class: 'da-wait'}, h('span', {class: 'spinner'}), 'Подтвердите вход в открывшемся браузере…') : null,
    h('button', {class: 'btn primary big', type: 'button', onclick: login}, daWaiting ? 'Открыть вход ещё раз' : 'Войти через DonationAlerts'),
    da.message && ['error', 'auth'].includes(da.state) ? h('p', {class: 'error-text'}, da.message) : null,
    daLogBlock()
  ].filter(Boolean));
}

function daLogBlock() {
  const lines = S.da.log || [];
  if (!lines.length) return null;
  const details = h('details', {class: 'da-log'}, h('summary', {}, 'Журнал подключения'),
    h('pre', {class: 'code-block'}, lines.join('\n')),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => copy(lines.join('\n'), 'Журнал скопирован')}, 'Скопировать журнал'));
  details.open = daLogOpen;
  details.addEventListener('toggle', () => { daLogOpen = details.open; });
  return details;
}
let daLogOpen = false;

async function reconnect() {
  try { apply(await api('/api/da/reconnect')); } catch (error) { toast(error.message, 'bad'); }
}

function renderQueue() {
  const queue = S.queue || [];
  $('#queue-count').textContent = queue.length ? `${queue.length} шт.` : '';
  if (!queue.length) {
    $('#queue-list').replaceChildren(h('p', {class: 'muted queue-empty'}, S.settings.paused ? 'Хаос на паузе.' : 'Пусто — новые донаты появятся здесь.'));
    return;
  }
  $('#queue-list').replaceChildren(...queue.map(item => {
    const left = Math.max(0, Math.round((Math.max(item.dueAt, item.retryAt || 0) - Date.now()) / 1000));
    return h('div', {class: 'queue-item'},
      h('div', {class: 'queue-main'},
        h('b', {}, effectOf(item.code)?.name || item.code),
        h('small', {}, `${item.donor || 'Зритель'}${item.amount != null ? ' · ' + money(item.amount, item.currency) : ''}${item.note ? ' · ' + item.note : ''}`)),
      h('span', {class: 'queue-time'}, S.settings.paused ? 'пауза' : left ? `через ${left} с` : 'сейчас'),
      h('button', {class: 'fx-test', type: 'button', title: 'Запустить сейчас', onclick: () => queueAction('run', item)}, '▶'),
      h('button', {class: 'fx-test', type: 'button', title: 'Отменить', onclick: () => queueAction('cancel', item)}, '✕'));
  }));
}

async function queueAction(action, item) {
  try { apply(await api(`/api/queue/${action}`, {id: item.id})); toast(action === 'run' ? 'Событие запущено' : 'Убрано из очереди', 'ok'); }
  catch (error) { toast(error.message, 'bad'); }
}
setInterval(() => { if (S?.queue?.length) renderQueue(); }, 1000);

function renderCoop() {
  const {remote = {}, sync = {}, mc} = S;
  const syncText = sync.state === 'error' ? sync.message : sync.revision ? `Настройки синхронизированы (версия ${sync.revision})` : '';
  $('#sync-state').textContent = syncText;
  $('#sync-state').className = `sync-state ${sync.state === 'error' ? 'bad' : 'ok'}`;
  const box = $('#coop-box');
  if (mc.state !== 'online') { box.replaceChildren(h('p', {class: 'muted'}, 'Откройте мир, чтобы включить совместную игру.')); return; }
  const addresses = remote.addresses?.length ? remote.addresses.join(', ') : 'не найден — включите Radmin VPN';
  box.replaceChildren(
    h('label', {class: 'switch-row'},
      h('input', {type: 'checkbox', checked: !!mc.remote, onchange: event => toggleRemote(event.target.checked)}), h('span', {class: 'switch'}),
      h('span', {}, h('b', {}, 'Разрешить подключение друга'), h('small', {}, 'Его приложение сможет запускать события в вашем мире'))),
    mc.remote ? h('div', {class: 'coop-info'},
      h('div', {}, h('span', {class: 'muted'}, 'Ваш адрес Radmin: '), h('b', {}, addresses)),
      h('div', {}, h('span', {class: 'muted'}, 'Код доступа: '), h('b', {class: 'code'}, remote.code || '…'),
        remote.code ? h('button', {class: 'link-btn', type: 'button', onclick: () => copy(`Адрес: ${remote.addresses?.[0] || ''}\nКод: ${remote.code}`, 'Адрес и код скопированы')}, ' Скопировать') : null)) : null);
}

async function toggleRemote(enable) {
  try { apply(await api('/api/remote', {enable})); toast(enable ? 'Друг может подключаться' : 'Подключение друга выключено', 'ok'); }
  catch (error) { toast(error.message, 'bad'); renderCoop(); }
}

function renderMcResult() {
  const {mc, settings} = S;
  const result = $('#mc-result');
  const kinds = {online: 'ok', version: 'warn', error: 'bad', simulate: 'sim'};
  // Режим переключён, но ещё не сохранён — старое сообщение («Мир не запущен» и т.п.) только путает.
  if (mcMode && mcMode !== settings.minecraft.mode) {
    result.replaceChildren(h('div', {class: 'result sim'}, 'Заполните поля и нажмите «Сохранить и проверить».'));
    return;
  }
  let text = mc.message;
  if (mc.state === 'online') text = `✓ Мод ${mc.version} отвечает. В сети: ${mc.players.join(', ') || 'никого'}.`;
  if (mc.state === 'online') text += mc.target ? ` Ваш ник: ${mc.target}.` : ' Ваш ник определится, когда вы зайдёте в мир.';
  result.replaceChildren(text && kinds[mc.state] ? h('div', {class: `result ${kinds[mc.state]}`}, text) : '');

  const list = $('#online-players');
  list.replaceChildren(...mc.players.map(name => h('button', {type: 'button', title: 'Выбрать этот ник', onclick: () => { $('#mc-form').elements.player.value = name; }}, '👤 ' + name)));
  $('#players').replaceChildren(...mc.players.map(name => h('option', {value: name})));
}

// ---------- События ----------
function duplicates() {
  const counts = new Map();
  for (const effect of S.catalog) {
    if (!S.settings.events[effect.code].enabled) continue;
    const key = cents(priceOf(effect.code));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

const POPOUT = new URLSearchParams(location.search).get('popout') === 'events';
let layout = 'grid', search = '', sortMode = 'catalog';
try { layout = localStorage.getItem('baranus-layout') || 'grid'; sortMode = localStorage.getItem('baranus-sort') || 'catalog'; } catch { /* без памяти */ }

const TARGET_LABEL = {receiver: 'получателю', all: 'всем'};
/** Коротко о настройках события: кому, количество/длительность/уровень, перезарядка. */
function eventMeta(effect) {
  const parts = [effect.target === 'all' ? '👥 всем стримерам' : '👤 получателю доната'];
  if (effect.params?.count) parts.push(`×${effect.params.count}`);
  if (effect.params?.seconds) parts.push(`${effect.params.seconds} с`);
  if (effect.params?.level) parts.push(`ур. ${effect.params.level}`);
  if (effect.cooldown) parts.push(`⏱ раз в ${effect.cooldown} с`);
  return parts.join(' · ');
}

function visibleEvents() {
  const query = search.trim().toLowerCase();
  const list = S.catalog.filter(effect => (filter === 'all' || effect.category === filter)
    && (!query || effect.name.toLowerCase().includes(query) || effect.code.includes(query) || (effect.desc || '').toLowerCase().includes(query)));
  if (sortMode === 'price-asc') list.sort((a, b) => priceOf(a.code) - priceOf(b.code));
  if (sortMode === 'price-desc') list.sort((a, b) => priceOf(b.code) - priceOf(a.code));
  if (sortMode === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return list;
}

function renderEvents() {
  const {settings, catalog, categories} = S;
  $('#currency').value = settings.currency;
  renderCurrencies();
  $('#code-trigger').checked = settings.codeTrigger;
  for (const [id, key] of [['#queue-delay', 'delay'], ['#queue-gap', 'gap']]) if (document.activeElement !== $(id)) $(id).value = settings.queue[key];
  $$('#fx-layout button').forEach(button => button.classList.toggle('active', button.dataset.layout === layout));
  $('#fx-sort').value = sortMode;
  const counts = duplicates();

  const all = [{id: 'all', name: 'Все'}, ...categories];
  $('#chips').replaceChildren(...all.map(category => {
    const total = category.id === 'all' ? catalog.length : catalog.filter(effect => effect.category === category.id).length;
    return h('button', {type: 'button', class: filter === category.id ? 'active' : '', onclick: () => { filter = category.id; renderEvents(); }},
      category.name, h('span', {class: 'count'}, total));
  }));

  // Не перерисовываем, пока пользователь вводит цену.
  if (document.activeElement?.closest?.('#fx-grid input[type=number]')) return;
  const grid = $('#fx-grid');
  grid.className = layout === 'list' ? 'fx-list' : 'fx-grid';
  const visible = visibleEvents();
  const create = layout === 'list'
    ? h('button', {class: 'fx-row fx-row-create', type: 'button', onclick: () => openEditor(null)}, '＋ Создать событие')
    : h('button', {class: 'fx fx-create', type: 'button', onclick: () => openEditor(null)},
      h('span', {class: 'plus'}, '＋'), h('b', {}, 'Создать событие'), h('small', {}, 'Своё событие из команд Minecraft'));
  const items = visible.map(effect => (layout === 'list' ? fxRow : fxCard)(effect, counts));
  grid.replaceChildren(...items, ...(items.length ? [] : [h('p', {class: 'muted empty-search'}, 'Ничего не найдено.')]),
    ...((filter === 'all' || filter === 'custom') && !search ? [create] : []));
  renderPriceStrip();
}

function enabledSwitch(effect, config) {
  return h('label', {class: 'switch-row', title: config.enabled ? 'Выключить событие' : 'Включить событие'},
    h('input', {type: 'checkbox', checked: config.enabled, onchange: event => save({events: {[effect.code]: {enabled: event.target.checked}}})}),
    h('span', {class: 'switch'}));
}

function priceInput(effect, config) {
  return h('label', {class: 'fx-price', title: 'Цена события'},
    h('input', {type: 'number', min: '1', step: '1', value: config.price, 'aria-label': `Цена: ${effect.name}`,
      onchange: event => save({events: {[effect.code]: {price: Number(event.target.value)}}}),
      onkeydown: event => { if (event.key === 'Enter') event.target.blur(); }}),
    h('em', {}, SYMBOL[S.settings.currency] || S.settings.currency));
}

function extraPrices(effect) {
  return Object.keys(effect.prices || {}).length
    ? h('button', {class: 'fx-prices', type: 'button', title: 'Цены в других валютах — нажмите, чтобы изменить', onclick: () => openEditor(effect.code)},
      ...Object.entries(effect.prices).map(([currency, price]) => h('span', {class: effect.manual?.includes(currency) ? 'manual' : ''}, money(price, currency))))
    : null;
}

const actionButtons = effect => [
  h('button', {class: 'fx-test fx-edit', type: 'button', title: 'Настроить событие', onclick: () => openEditor(effect.code)}, '✎'),
  h('button', {class: 'fx-test', type: 'button', title: 'Запустить в игре сейчас', onclick: event => testEffect(effect, event.currentTarget)}, '▶')
];

function fxCard(effect, counts) {
  const config = S.settings.events[effect.code];
  const same = config.enabled ? counts.get(cents(config.price)) : 0;
  return h('article', {class: `fx ${config.enabled ? '' : 'off'}`, dataset: {code: effect.code}},
    h('div', {class: 'fx-top'},
      h('div', {class: 'fx-name'}, effect.name, effect.custom ? h('span', {class: 'fx-tag'}, 'своё') : null),
      enabledSwitch(effect, config)),
    same > 1 ? h('span', {class: 'fx-badge', title: 'У нескольких событий эта цена — выпадет случайное'}, `🎲 ×${same}`) : null,
    h('div', {class: 'fx-desc'}, effect.desc || (effect.custom ? `${effect.commands.length} ${plural(effect.commands.length, 'команда', 'команды', 'команд')}` : '')),
    h('div', {class: 'fx-meta'}, eventMeta(effect)),
    h('div', {class: 'fx-bottom'}, priceInput(effect, config), ...actionButtons(effect)),
    extraPrices(effect));
}

function fxRow(effect, counts) {
  const config = S.settings.events[effect.code];
  const same = config.enabled ? counts.get(cents(config.price)) : 0;
  return h('div', {class: `fx-row ${config.enabled ? '' : 'off'}`, dataset: {code: effect.code}},
    enabledSwitch(effect, config),
    h('div', {class: 'fx-row-main'},
      h('div', {class: 'fx-name'}, effect.name, effect.custom ? h('span', {class: 'fx-tag'}, 'своё') : null,
        same > 1 ? h('span', {class: 'fx-tag dice', title: 'Одинаковая цена — выпадет случайное'}, `🎲 ×${same}`) : null),
      h('div', {class: 'fx-meta'}, eventMeta(effect))),
    extraPrices(effect) || h('span'),
    priceInput(effect, config),
    ...actionButtons(effect));
}

$('#fx-search').addEventListener('input', event => { search = event.target.value; renderEvents(); });
$('#fx-sort').addEventListener('change', event => {
  sortMode = event.target.value;
  try { localStorage.setItem('baranus-sort', sortMode); } catch { /* без памяти */ }
  renderEvents();
});
$('#fx-layout').addEventListener('click', event => {
  const button = event.target.closest('button[data-layout]');
  if (!button) return;
  layout = button.dataset.layout;
  try { localStorage.setItem('baranus-layout', layout); } catch { /* без памяти */ }
  renderEvents();
});
$('#popout').addEventListener('click', () => window.open('/?popout=events', 'baranus-events', 'width=1180,height=820'));
for (const [id, key] of [['#queue-delay', 'delay'], ['#queue-gap', 'gap']]) {
  $(id).addEventListener('change', event => save({queue: {[key]: Number(event.target.value)}}, key === 'delay' ? 'Задержка сохранена' : 'Пауза сохранена'));
}

// ---------- Валюты ----------
async function refreshRatesNow(button) {
  button.disabled = true;
  try { apply(await api('/api/rates/refresh')); toast('Курсы обновлены', 'ok'); }
  catch (error) { toast(error.message, 'bad'); }
  finally { button.disabled = false; }
}

function renderCurrencies() {
  const {settings, rates} = S;
  const main = settings.currency;
  const extras = Object.entries(settings.extraCurrencies);
  // Все валюты — кнопки-переключатели: нажал — валюта принимается, курс подтягивается из интернета.
  const toggles = S.currencies.filter(code => code !== main).map(code => {
    const active = !!settings.extraCurrencies[code];
    return h('button', {type: 'button', class: `cur-toggle${active ? ' active' : ''}`, title: CURRENCY_NAME[code] || code,
      onclick: event => {
        event.currentTarget.disabled = true;
        save({extraCurrencies: {[code]: active ? null : {}}}, active ? `${code} убрана` : `${code} добавлена, цены посчитаны по курсу`);
      }},
      h('b', {}, SYMBOL[code] || code), ` ${code}`);
  });
  $('#cur-list').replaceChildren(...toggles);
  const updated = rates?.updatedAt ? new Date(rates.updatedAt).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : null;
  $('#cur-rates').replaceChildren(...(extras.length ? [
    h('span', {}, extras.map(([code, {rate}]) => `1 ${SYMBOL[code] || code} = ${num(rate)} ${SYMBOL[main] || main}`).join(' · ')),
    h('span', {class: rates?.state === 'error' ? 'error-text' : 'muted'},
      rates?.state === 'error' ? rates.message : updated ? `курс ${rates.source} на ${updated}` : 'курс обновляется…'),
    h('button', {type: 'button', class: 'link-btn', onclick: event => refreshRatesNow(event.currentTarget)}, '↻ Обновить курс'),
    h('button', {type: 'button', class: 'link-btn', title: 'Сбросить ручные цены в других валютах',
      onclick: () => { if (confirm('Посчитать все цены в других валютах заново по текущему курсу? Ручные цены будут сброшены.')) save({recalcPrices: true}, 'Цены пересчитаны по курсу'); }}, 'Сбросить ручные цены')
  ] : [h('span', {class: 'muted'}, 'Выберите валюты, в которых донатят ваши зрители, — цены посчитаются по актуальному курсу.')]));
  // Тестовый донат: основная + дополнительные валюты
  const select = $('#test-currency');
  const current = select.value;
  select.replaceChildren(...[main, ...extras.map(([code]) => code)].map(code => h('option', {value: code}, `${code} ${SYMBOL[code] || ''}`)));
  select.value = [main, ...Object.keys(settings.extraCurrencies)].includes(current) ? current : main;
}

const plural = (count, one, few, many) => {
  const mod10 = count % 10, mod100 = count % 100;
  return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
};

// ---------- Редактор событий ----------
let editing = null;

function openEditor(code) {
  const dialog = $('#event-editor');
  const form = $('#event-form').elements;
  const effect = code ? effectOf(code) : null;
  editing = effect;
  const custom = !effect || effect.custom;
  dialog.classList.toggle('is-custom', custom);
  $('#editor-title').textContent = !effect ? 'Новое событие' : custom ? 'Своё событие' : 'Встроенное событие';
  form.name.value = effect?.name || '';
  form.desc.value = effect?.desc || '';
  form.price.value = effect ? priceOf(effect.code) : suggestPrice();
  form.enabled.checked = effect ? effect.enabled : true;
  form.commands.value = effect?.commands?.join('\n') || '';
  form.target.value = effect?.target || 'receiver';
  form.cooldown.value = effect?.cooldown || '';
  // Сила и длительность — только у встроенных событий, где они есть.
  $('#editor-params').replaceChildren(...Object.entries(effect?.schema || {}).map(([param, [min, max]]) =>
    h('label', {class: 'field price-field'}, S.paramNames?.[param] || param,
      h('input', {type: 'number', min: String(min), max: String(max), step: '1', 'data-param': param, value: effect.params[param]}))));
  form.commands.required = custom;
  const remove = $('#editor-delete');
  remove.hidden = !effect || (!custom && !effect.renamed);
  remove.textContent = custom ? 'Удалить' : 'Вернуть исходное';
  $('#editor-test').hidden = !effect;
  // Цены в дополнительных валютах: пусто — считать по курсу, число — своя цена.
  const extras = Object.keys(S.settings.extraCurrencies);
  $('#extra-prices').replaceChildren(...(extras.length ? [h('span', {class: 'tool-label'}, 'Цены для зрителей в других валютах · пусто = по курсу')] : []),
    h('div', {class: 'row wrap'}, ...extras.map(currency => h('label', {class: 'field extra-price'}, `${currency} ${SYMBOL[currency] || ''}`,
      h('input', {type: 'number', min: '1', step: '1', 'data-currency': currency,
        value: effect?.manual?.includes(currency) ? effect.prices[currency] : '',
        placeholder: effect ? `${num(effect.prices[currency])} по курсу` : 'по курсу'})))));
  $$('.money .cur').forEach(el => { el.textContent = SYMBOL[S.settings.currency] || S.settings.currency; });
  dialog.showModal();
  (effect ? form.price : form.name).focus();
}

/** Свободная «круглая» цена для нового события, чтобы не совпасть с существующими. */
function suggestPrice() {
  const used = new Set(S.catalog.map(effect => cents(priceOf(effect.code))));
  for (let price = 111; price < 100000; price += 10) if (!used.has(price * 100)) return price;
  return 111;
}

$('#create-event').addEventListener('click', () => openEditor(null));
$('#editor-close').addEventListener('click', () => $('#event-editor').close());
$('#event-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.elements;
  const body = {code: editing?.code, name: form.name.value, desc: form.desc.value,
    price: Number(form.price.value), enabled: form.enabled.checked,
    prices: Object.fromEntries($$('#extra-prices input[data-currency]').map(input => [input.dataset.currency, input.value === '' ? null : Number(input.value)])),
    target: form.target.value, cooldown: Number(form.cooldown.value || 0),
    ...Object.fromEntries($$('#editor-params input[data-param]').map(input => [input.dataset.param, Number(input.value)]))};
  if (!editing || editing.custom) body.commands = form.commands.value;
  try {
    apply(await api('/api/events/save', body));
    $('#event-editor').close();
    toast(editing ? 'Событие сохранено' : 'Событие создано', 'ok');
    if (!editing) { filter = 'custom'; renderEvents(); }
  } catch (error) { toast(error.message, 'bad'); }
});
$('#editor-delete').addEventListener('click', async () => {
  if (!editing) return;
  const question = editing.custom ? `Удалить событие «${editing.name}»?` : `Вернуть исходное название, иконку и описание «${editing.original.name}»?`;
  if (!confirm(question)) return;
  try {
    apply(await api('/api/events/delete', {code: editing.code}));
    $('#event-editor').close();
    toast(editing.custom ? 'Событие удалено' : 'Исходные данные возвращены', 'ok');
  } catch (error) { toast(error.message, 'bad'); }
});
$('#editor-test').addEventListener('click', event => { if (editing) testEffect(editing, event.currentTarget); });

function renderPriceStrip() {
  const enabled = S.catalog.filter(effect => S.settings.events[effect.code].enabled)
    .sort((a, b) => priceOf(a.code) - priceOf(b.code));
  $$('.money .cur').forEach(el => { el.textContent = SYMBOL[S.settings.currency] || S.settings.currency; });
  $('#price-strip').replaceChildren(...enabled.map(effect => h('button', {type: 'button', title: effect.name,
    onclick: () => { $('#test-donation').elements.amount.value = priceOf(effect.code); }}, effect.icon, ' ', money(priceOf(effect.code)))));
}

function priceText() {
  const enabled = S.catalog.filter(effect => S.settings.events[effect.code].enabled).sort((a, b) => priceOf(a.code) - priceOf(b.code));
  const head = 'Задонать ровно эту сумму — и в моём Minecraft случится событие:';
  const lines = enabled.map(effect => [money(priceOf(effect.code)), ...Object.entries(effect.prices || {}).map(([currency, price]) => money(price, currency))]
    .join(' / ') + ` — ${effect.name}`);
  const link = S.da.profile?.code ? [`Донат: https://www.donationalerts.com/r/${S.da.profile.code}`] : [];
  return [head, ...lines, ...link].join('\n');
}

async function save(patch, message = 'Сохранено') {
  try {
    apply(await api('/api/settings', patch));
    if (message) toast(message, 'ok');
  } catch (error) {
    toast(error.message, 'bad');
    renderEvents();
  }
}

async function testEffect(effect, button) {
  button.disabled = true;
  try {
    const result = await api('/api/test/effect', {code: effect.code});
    const name = effectOf(result.code)?.name || effect.name;
    toast(result.simulated ? `Симуляция: ${name}` : `▶ ${name} — в игре`, 'ok');
  } catch (error) {
    toast(`${effect.name}: ${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

// ---------- Лента ----------
function feedItem(item) {
  const effect = item.code ? effectOf(item.code) : null;
  const donor = h('b', {}, item.donor || 'Зритель');
  const title = effect ? [donor, h('span', {class: 'arrow'}, '→'), effect.name]
    : item.code ? [donor, h('span', {class: 'arrow'}, '→'), item.code] : [donor, ' — донат без события'];
  const details = [];
  if (item.amount != null) details.push(money(item.amount, item.currency));
  if (item.requested === 'random' && item.code !== 'random') details.push('🎲 случайное событие');
  else if (item.pool > 1) details.push(`🎲 одно из ${item.pool}`);
  if (item.via === 'code') details.push('по коду в сообщении');
  if (item.message) details.push(`«${item.message.length > 90 ? item.message.slice(0, 90) + '…' : item.message}»`);
  if (item.reason) details.push(item.reason);
  const canReplay = ['failed', 'skipped'].includes(item.state) && item.code && !item.replayed;
  return h('div', {class: `feed-item ${item.state}`},
    h('div', {class: 'feed-icon'}, effect?.icon || '💸'),
    h('div', {}, h('div', {class: 'feed-title'}, title), h('div', {class: 'feed-sub'}, details.join(' · '))),
    h('div', {class: 'feed-meta'},
      h('div', {}, KIND_LABEL[item.kind] ? h('span', {class: 'chip kind'}, KIND_LABEL[item.kind]) : null, ' ',
        h('span', {class: `chip ${item.state}`}, STATE_LABEL[item.state] || item.state)),
      h('time', {}, new Date(item.at).toLocaleTimeString('ru-RU')),
      canReplay ? h('button', {class: 'btn small', type: 'button', onclick: event => replay(item, event.currentTarget)}, '↻ Запустить') : null));
}

function renderFeed() {
  const feed = $('#feed');
  $('#feed-count').textContent = S.history.length ? `${S.history.length} шт.` : '';
  if (!S.history.length) {
    feed.replaceChildren(h('div', {class: 'feed-empty'}, h('b', {}, '🎲'), h('span', {}, 'Здесь появятся донаты и события.'),
      h('small', {}, 'Отправьте тестовый донат справа, чтобы проверить.')));
    return;
  }
  feed.replaceChildren(...S.history.slice(0, 100).map(feedItem));
}

async function replay(item, button) {
  button.disabled = true;
  try {
    const result = await api('/api/replay', {id: item.id});
    toast(result.simulated ? 'Повтор выполнен (симуляция)' : 'Событие запущено', 'ok');
  } catch (error) {
    toast(error.message, 'bad');
    button.disabled = false;
  }
}

// ---------- Формы ----------
function fillForms() {
  const {minecraft, daClientId} = S.settings;
  const mcForm = $('#mc-form').elements;
  setMcMode(minecraft.mode);
  mcForm.host.value = minecraft.host;
  mcForm.port.value = minecraft.port;
  mcForm.player.value = minecraft.player;
  mcForm.friendHost.value = minecraft.friendHost || '';
  mcForm.friendCode.value = '';
  mcForm.friendCode.placeholder = minecraft.hasFriendCode ? 'Сохранён' : 'из приложения друга';
  mcForm.password.value = '';
  mcForm.password.placeholder = minecraft.hasPassword ? 'Сохранён — оставьте пустым' : 'rcon.password из server.properties';
  const client = $('#client-form').elements;
  client.clientId.value = daClientId;
  client.clientId.placeholder = S.defaultClientId;
  client.clientSecret.value = '';
  client.clientSecret.placeholder = S.settings.hasDaSecret ? 'Сохранён — оставьте пустым' : 'Необязательно';
  $('#secret-hint').textContent = S.settings.hasDaSecret
    ? '✓ Секрет сохранён: вход через код, токен обновляется сам.'
    : 'Без секрета используется упрощённый вход (Implicit). Если он не срабатывает — впишите Client Secret.';
  if (!S.settings.hasDaSecret && ['error', 'auth'].includes(S.da.state)) $('.advanced').open = true;
  $('#currency').replaceChildren(...S.currencies.map(code => h('option', {value: code}, `${code} ${SYMBOL[code] || ''}`)));
  $('#currency').value = S.settings.currency;
}

function renderAll() {
  renderStatus();
  renderEvents();
  renderFeed();
}

async function login() {
  try {
    const {url} = await api('/api/da/login');
    daWaiting = true;
    renderDaBox();
    window.open(url, '_blank', 'noopener');
  } catch (error) { toast(error.message, 'bad'); }
}

async function logout() {
  if (!confirm('Отключить DonationAlerts? Донаты перестанут запускать события.')) return;
  try { apply(await api('/api/da/logout')); toast('DonationAlerts отключён'); } catch (error) { toast(error.message, 'bad'); }
}

$('#chaos-toggle').addEventListener('click', () => {
  const paused = !S.settings.paused;
  save({paused}, paused ? 'Хаос на паузе' : 'Хаос включён');
});

$('#currency').addEventListener('change', event => {
  const next = event.target.value;
  if (!confirm(`Сделать ${next} основной валютой? Цифры цен останутся прежними — проверьте их, а курсы других валют будут взяты примерные.`)) {
    event.target.value = S.settings.currency;
    return;
  }
  save({currency: next}, `Основная валюта: ${next}`);
});
$('#code-trigger').addEventListener('change', event => save({codeTrigger: event.target.checked}));
$('#copy-price').addEventListener('click', () => copy(priceText(), 'Прайс скопирован'));
$('#copy-price-dash').addEventListener('click', () => copy(priceText(), 'Прайс скопирован'));

$('#test-donation').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.elements;
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/api/test/donation', {amount: Number(form.amount.value), currency: form.currency.value, username: form.username.value});
    const name = effectOf(result.code)?.name || 'Событие';
    const wait = result.dueAt ? Math.max(0, Math.round((result.dueAt - Date.now()) / 1000)) : 0;
    toast(result.queued ? `${name} — в очереди${wait ? `, через ${wait} с` : ''}` : `${name}${result.simulated ? ' (симуляция)' : ' — в игре'}`, 'ok');
  } catch (error) { toast(error.message, 'bad'); }
  finally { button.disabled = false; }
});


$('#resume-game').addEventListener('click', async () => {
  try { apply(await api('/api/minecraft/resume')); toast('Пауза в игре снята', 'ok'); } catch (error) { toast(error.message, 'bad'); }
});

$('#mc-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.elements;
  const button = event.target.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Проверяю…';
  try {
    apply(await api('/api/minecraft', {mode: mcMode, host: form.host.value.trim(), port: Number(form.port.value) || undefined,
      friendHost: form.friendHost.value.trim(), friendCode: form.friendCode.value.trim(),
      password: form.password.value, player: form.player.value.trim()}));
    fillForms();
    const {mc} = S;
    if (mc.state === 'online') toast('Minecraft подключён ✓', 'ok');
    else toast(mc.message || 'Сохранено', mc.state === 'error' ? 'bad' : '');
  } catch (error) { toast(error.message, 'bad'); }
  finally { button.disabled = false; button.textContent = 'Сохранить и проверить'; }
});

$('#client-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.elements;
  try {
    apply(await api('/api/da/client-id', {clientId: form.clientId.value.trim(), clientSecret: form.clientSecret.value}));
    fillForms();
    toast('Данные приложения сохранены', 'ok');
    await login();
  } catch (error) { toast(error.message, 'bad'); }
});

let mcMode = 'local';
function setMcMode(mode) {
  mcMode = mode;
  $('#mc-form').dataset.mode = mode;
  $('#mc-form').classList.toggle('local', mode === 'local');
  $('#coop').hidden = mode !== 'local';
  $$('#mc-mode button').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  if (S) renderMcResult();
}
$('#mc-mode').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (button) setMcMode(button.dataset.mode);
});

// ---------- Живые обновления ----------
function connectStream() {
  const stream = new EventSource('/api/stream');
  stream.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      const wasOnline = S.da.state === 'online';
      Object.assign(S, message.state);
      if (!wasOnline && S.da.state === 'online') toast('DonationAlerts подключён ✓', 'ok');
      renderStatus();
      renderEvents();
    } else if (message.type === 'history') {
      S.history.unshift(message.entry);
      S.history.splice(200);
      renderFeed();
    } else if (message.type === 'dalog') {
      S.da.log = [...(S.da.log || []), message.line].slice(-12);
      if (S.da.state !== 'online') renderDaBox();
    } else if (message.type === 'queue') {
      S.queue = message.queue;
      renderQueue();
    } else if (message.type === 'replayed') {
      const item = S.history.find(entry => entry.id === message.id);
      if (item) { item.replayed = true; renderFeed(); }
    }
  };
}

async function init() {
  S = await fetch('/api/state').then(response => response.json());
  $('#version').textContent = `v${S.version} · мод ${S.modVersion}`;
  fillForms();
  renderAll();
  connectStream();
  let view = 'dashboard';
  try { view = localStorage.getItem('baranus-view') || view; } catch { /* без памяти */ }
  if (POPOUT) { document.body.classList.add('popout'); document.title = 'События — Baranus Chaos'; show('events'); return; }
  show($(`#view-${view}`) ? view : 'dashboard');
}

init().catch(error => toast('Не удалось загрузить интерфейс: ' + error.message, 'bad'));
