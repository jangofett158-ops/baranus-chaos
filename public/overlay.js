// Уведомления показываются сразу, без очереди: несколько событий видны стопкой.
const SYMBOL = {RUB: '₽', USD: '$', EUR: '€', UAH: '₴', KZT: '₸', BYN: 'Br'};
const stack = document.getElementById('stack');
let options = {color: '#e8263a', duration: 6, position: 'bottom-left', showAmount: true};

function configure(value) {
  options = value;
  document.documentElement.style.setProperty('--accent', value.color);
  stack.className = value.position;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function show(alert) {
  const card = el('div', 'alert');
  const text = el('div', 'text');
  text.append(el('small', '', alert.test ? 'BARANUS CHAOS · ТЕСТ' : 'BARANUS CHAOS'), el('b', '', alert.name));
  const from = el('span', '', alert.donor || 'Зритель');
  if (options.showAmount && alert.amount != null) {
    const amount = Number(alert.amount).toLocaleString('ru-RU', {maximumFractionDigits: 2});
    from.append(el('em', '', `${amount} ${SYMBOL[alert.currency] || alert.currency || ''}`));
  }
  text.append(from);
  card.append(el('div', 'icon', alert.icon || '✨'), text);
  stack.append(card);
  while (stack.children.length > 5) stack.firstElementChild.remove();
  setTimeout(() => {
    card.classList.add('leave');
    setTimeout(() => card.remove(), 400);
  }, options.duration * 1000);
}

const stream = new EventSource('/api/stream');
stream.onmessage = event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === 'overlay') configure(message.overlay);
  if (message.type === 'alert') show(message.alert);
};
