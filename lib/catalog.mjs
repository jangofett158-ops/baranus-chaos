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
  {code: 'speed', name: 'Скорость', icon: '⚡', category: 'help', price: 25, desc: 'Ускорение II на 30 секунд'},
  {code: 'buff', name: 'Мощь', icon: '💪', category: 'help', price: 69, desc: 'Сила и сопротивление на 30 секунд'},
  {code: 'gift', name: 'Подарок', icon: '🎁', category: 'help', price: 39, desc: 'Случайный полезный предмет'},
  {code: 'diamond', name: 'Алмазы', icon: '💎', category: 'help', price: 59, desc: 'Два алмаза в инвентарь'},
  {code: 'wolf', name: 'Пёс-защитник', icon: '🐺', category: 'help', price: 79, desc: 'Приручённый волк с ником зрителя'},
  {code: 'golem', name: 'Железный голем', icon: '🛡️', category: 'help', price: 149, desc: 'Голем-охранник рядом с игроком'},
  // Пакости
  {code: 'blind', name: 'Слепота', icon: '🙈', category: 'prank', price: 35, desc: 'Слепота на 10 секунд'},
  {code: 'drunk', name: 'Головокружение', icon: '🥴', category: 'prank', price: 30, desc: 'Тошнота на 15 секунд'},
  {code: 'darkness', name: 'Темнота', icon: '🌑', category: 'prank', price: 45, desc: 'Пульсирующая тьма на 15 секунд'},
  {code: 'freeze', name: 'Заморозка', icon: '🧊', category: 'prank', price: 55, desc: 'Почти не может двигаться 8 секунд'},
  {code: 'launch', name: 'В небо!', icon: '🚀', category: 'prank', price: 40, desc: 'Подбрасывает игрока, плавное падение'},
  {code: 'drop', name: 'Выронить', icon: '✋', category: 'prank', price: 75, desc: 'Предмет из руки падает на землю'},
  {code: 'hotbar', name: 'Перемешать', icon: '🔀', category: 'prank', price: 89, desc: 'Перемешивает слоты хотбара'},
  // Мобы
  {code: 'pig', name: 'Свинка', icon: '🐷', category: 'mobs', price: 15, desc: 'Свинья с ником зрителя'},
  {code: 'zombie', name: 'Зомби', icon: '🧟', category: 'mobs', price: 20, desc: 'Зомби с ником зрителя'},
  {code: 'skeleton', name: 'Скелет', icon: '🏹', category: 'mobs', price: 50, desc: 'Скелет-лучник с ником зрителя'},
  {code: 'creeper', name: 'Крипер', icon: '💚', category: 'mobs', price: 60, desc: 'Крипер появляется рядом'},
  // Хаос
  {code: 'chickenrain', name: 'Куриный дождь', icon: '🐔', category: 'chaos', price: 70, desc: 'Восемь куриц падают с неба'},
  {code: 'lightning', name: 'Молния', icon: '🌩️', category: 'chaos', price: 80, desc: 'Безопасная молния рядом с игроком'},
  {code: 'faketnt', name: 'Фейковый TNT', icon: '🧨', category: 'chaos', price: 85, desc: 'Шипит и «взрывается» без разрушений'},
  {code: 'night', name: 'Ночь', icon: '🌙', category: 'chaos', price: 65, desc: 'Мгновенно наступает ночь'},
  {code: 'storm', name: 'Гроза', icon: '⛈️', category: 'chaos', price: 99, desc: 'Гроза на 2 минуты'},
  {code: 'giantzombie', name: 'Огненный гигант', icon: '👹', category: 'chaos', price: 199, desc: 'Гигантский зомби с огненными шарами, 3 минуты'},
  {code: 'random', name: 'Случайное событие', icon: '🎲', category: 'chaos', price: 100, desc: 'Любое включённое событие наугад'}
]);

export const CODES = Object.freeze(EFFECTS.map(effect => effect.code));
/** События, которые выполняет мод. «random» решается в приложении. */
export const MOD_CODES = Object.freeze(CODES.filter(code => code !== 'random'));
export const PRESETS = Object.freeze({small: 1, medium: 2, large: 5});

const byCode = new Map(EFFECTS.map(effect => [effect.code, effect]));
export const effectByCode = code => byCode.get(code);
