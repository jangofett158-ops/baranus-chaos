// Каталог событий. Код события совпадает с кодом в Forge-моде (ChaosEffects.java).
// price — базовая цена пресета «Небольшой канал» в рублях. Все базовые цены разные,
// поэтому каждой сумме соответствует ровно одно событие.

export const CATEGORIES = Object.freeze([
  {id: 'help', name: 'Помощь'},
  {id: 'prank', name: 'Пакости'},
  {id: 'mobs', name: 'Мобы'},
  {id: 'chaos', name: 'Хаос'},
  {id: 'custom', name: 'Свои'}
]);

export const EFFECTS = Object.freeze([
  // Помощь
  {code: 'heal', name: 'Исцеление', icon: '❤️', category: 'help', price: 49, desc: 'Полностью восстанавливает здоровье и тушит огонь'},
  {code: 'food', name: 'Накормить', icon: '🍗', category: 'help', price: 29, desc: 'Заполняет шкалу голода и насыщения'},
  {code: 'speed', name: 'Скорость', icon: '⚡', category: 'help', price: 25, desc: 'Ускорение'},
  {code: 'buff', name: 'Мощь', icon: '💪', category: 'help', price: 69, desc: 'Сила и сопротивление'},
  {code: 'gift', name: 'Подарок', icon: '🎁', category: 'help', price: 39, desc: 'Случайные полезные предметы'},
  {code: 'diamond', name: 'Алмазы', icon: '💎', category: 'help', price: 59, desc: 'Алмазы в инвентарь'},
  {code: 'wolf', name: 'Пёс-защитник', icon: '🐺', category: 'help', price: 79, desc: 'Приручённые волки с ником зрителя'},
  {code: 'golem', name: 'Железный голем', icon: '🛡️', category: 'help', price: 149, desc: 'Голем-охранник рядом с игроком'},
  // Пакости
  {code: 'blind', name: 'Слепота', icon: '🙈', category: 'prank', price: 35, desc: 'Слепота'},
  {code: 'drunk', name: 'Головокружение', icon: '🥴', category: 'prank', price: 30, desc: 'Тошнота'},
  {code: 'darkness', name: 'Темнота', icon: '🌑', category: 'prank', price: 45, desc: 'Пульсирующая тьма'},
  {code: 'freeze', name: 'Заморозка', icon: '🧊', category: 'prank', price: 55, desc: 'Почти не может двигаться'},
  {code: 'launch', name: 'В небо!', icon: '🚀', category: 'prank', price: 40, desc: 'Подбрасывает игрока, плавное падение'},
  {code: 'drop', name: 'Выронить', icon: '✋', category: 'prank', price: 75, desc: 'Предмет из руки падает на землю'},
  {code: 'hotbar', name: 'Перемешать', icon: '🔀', category: 'prank', price: 89, desc: 'Перемешивает слоты хотбара'},
  // Мобы
  {code: 'pig', name: 'Свинка', icon: '🐷', category: 'mobs', price: 15, desc: 'Свиньи с ником зрителя'},
  {code: 'zombie', name: 'Зомби', icon: '🧟', category: 'mobs', price: 20, desc: 'Зомби с ником зрителя'},
  {code: 'skeleton', name: 'Скелет', icon: '🏹', category: 'mobs', price: 50, desc: 'Скелеты-лучники с ником зрителя'},
  {code: 'creeper', name: 'Крипер', icon: '💚', category: 'mobs', price: 60, desc: 'Криперы рядом'},
  // Хаос
  {code: 'chickenrain', name: 'Куриный дождь', icon: '🐔', category: 'chaos', price: 70, desc: 'Курицы падают с неба'},
  {code: 'lightning', name: 'Молния', icon: '🌩️', category: 'chaos', price: 80, desc: 'Безопасные молнии рядом с игроком'},
  {code: 'faketnt', name: 'Фейковый TNT', icon: '🧨', category: 'chaos', price: 85, desc: 'Шипит и «взрывается» без разрушений'},
  {code: 'night', name: 'Ночь', icon: '🌙', category: 'chaos', price: 65, desc: 'Мгновенно наступает ночь'},
  {code: 'storm', name: 'Гроза', icon: '⛈️', category: 'chaos', price: 99, desc: 'Гроза'},
  {code: 'random', name: 'Случайное событие', icon: '🎲', category: 'chaos', price: 100, desc: 'Любое включённое событие наугад'}
]);

/**
 * Кому срабатывает событие по умолчанию: receiver — стример, которому пришёл донат (мобы появляются рядом с ним),
 * all — все стримеры в мире (эффекты на игрока). Можно поменять в настройках события.
 */
export const DEFAULT_TARGET = Object.freeze({
  heal: 'all', food: 'all', speed: 'all', buff: 'all', gift: 'all', diamond: 'all',
  blind: 'all', drunk: 'all', darkness: 'all', freeze: 'all', launch: 'all', drop: 'all', hotbar: 'all'
});

export const CODES = Object.freeze(EFFECTS.map(effect => effect.code));
/** События, которые выполняет мод. «random» решается в приложении. */
export const MOD_CODES = Object.freeze(CODES.filter(code => code !== 'random'));
export const PRESETS = Object.freeze({small: 1, medium: 2, large: 5});

const byCode = new Map(EFFECTS.map(effect => [effect.code, effect]));
export const effectByCode = code => byCode.get(code);
