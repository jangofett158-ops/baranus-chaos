import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, applyPatch, loadSettings, effectiveEvents, priceIn, exportShared, mergeShared} from '../lib/settings.mjs';

test('своё событие: создание, проверка команд, удаление', () => {
  const base = defaultSettings();
  const created = applyPatch(base, {customEvents: {c_boom: {name: ' Бум ', icon: '💥', desc: 'Взрыв', commands: '/say {donor}\n\n effect give {player} minecraft:glowing 5 '}}});
  assert.deepEqual(created.customEvents.c_boom.commands, ['say {donor}', 'effect give {player} minecraft:glowing 5']);
  assert.equal(created.customEvents.c_boom.name, 'Бум');
  assert.deepEqual(created.events.c_boom, {price: 100, enabled: true});
  const listed = effectiveEvents(created).find(item => item.code === 'c_boom');
  assert.equal(listed.custom, true);
  assert.equal(listed.category, 'custom');
  assert.throws(() => applyPatch(base, {customEvents: {c_boom: {name: 'X', icon: '💥', commands: ''}}}), /команду/);
  assert.throws(() => applyPatch(base, {customEvents: {'../x': {name: 'X', icon: '💥', commands: 'say'}}}), /код/);
  assert.throws(() => applyPatch(base, {customEvents: {c_boom: {name: 'X', icon: '💥', commands: Array(11).fill('say')}}}), /Не больше 10/);
  const removed = applyPatch(created, {customEvents: {c_boom: null}});
  assert.equal(removed.customEvents.c_boom, undefined);
  assert.equal(removed.events.c_boom, undefined);
});

test('доллары и евро: цена по курсу до цента, ручная цена с копейками, пересчёт и смена основной', () => {
  let s = applyPatch(defaultSettings(), {extraCurrencies: {USD: {}, EUR: {rate: 100}}});
  assert.equal(s.extraCurrencies.USD.rate, 90);
  assert.equal(priceIn(s, 'golem', 'USD'), 1.66, '149 / 90 = 1,6555… → вверх до цента');
  assert.equal(priceIn(s, 'golem', 'EUR'), 1.49);
  assert.equal(priceIn(s, 'zombie', 'USD'), 0.23, '20 / 90 = 0,222… → 0,23');
  s = applyPatch(s, {events: {golem: {price: 1200}}});
  assert.equal(priceIn(s, 'golem', 'EUR'), 12, 'цена по курсу следует за основной');
  s = applyPatch(s, {events: {golem: {prices: {EUR: 12.5}}}});
  assert.equal(priceIn(s, 'golem', 'EUR'), 12.5, 'ручная цена с копейками');
  assert.deepEqual(effectiveEvents(s).find(e => e.code === 'golem').manual, ['EUR']);
  s = applyPatch(s, {events: {golem: {prices: {USD: 0.999}}}});
  assert.equal(priceIn(s, 'golem', 'USD'), 1, 'копейки - не больше двух знаков');
  s = applyPatch(s, {recalcPrices: true});
  assert.equal(priceIn(s, 'golem', 'EUR'), 12);
  assert.equal(applyPatch(s, {events: {zombie: {price: 20.4}}}).events.zombie.price, 20, 'рубли - только целыми');
  assert.throws(() => applyPatch(s, {extraCurrencies: {UAH: {}}}), /Неизвестная валюта/, 'кроме ₽, $ и € валют нет');
  assert.throws(() => applyPatch(s, {extraCurrencies: {RUB: {}}}), /основная/);
  const switched = applyPatch(s, {currency: 'USD'});
  assert.equal(switched.extraCurrencies.USD, undefined);
  assert.equal(switched.extraCurrencies.EUR.rate, 1.0889);
  const reloaded = loadSettings(JSON.parse(JSON.stringify(applyPatch(s, {events: {zombie: {prices: {USD: 0.5}}}}))));
  assert.equal(priceIn(reloaded, 'zombie', 'USD'), 0.5);
});

test('старые валюты и настройки прежних версий отбрасываются при загрузке', () => {
  const raw = JSON.parse(JSON.stringify(applyPatch(defaultSettings(), {extraCurrencies: {USD: {rate: 90}}})));
  raw.extraCurrencies.KZT = {rate: 0.18};
  raw.events.zombie = {price: 20, enabled: true, cooldown: 30, count: 3, prices: {USD: 0.5, KZT: 100}};
  raw.queue = {delay: 20, gap: 5};
  const loaded = loadSettings(raw);
  assert.deepEqual(Object.keys(loaded.extraCurrencies), ['USD']);
  assert.deepEqual(loaded.events.zombie, {price: 20, enabled: true, prices: {USD: 0.5}}, 'цена в долларах осталась, тенге, перезарядка и количество - нет');
  assert.deepEqual(loaded.queue, {delay: 20});
});

test('встроенное событие можно переименовать и вернуть как было', () => {
  const renamed = applyPatch(defaultSettings(), {events: {zombie: {name: 'Мертвяк', icon: '💀', desc: 'Свой текст'}}});
  const zombie = effectiveEvents(renamed).find(item => item.code === 'zombie');
  assert.equal(zombie.name, 'Мертвяк');
  assert.equal(zombie.renamed, true);
  const reset = applyPatch(renamed, {events: {zombie: {reset: true}}});
  assert.equal(effectiveEvents(reset).find(item => item.code === 'zombie').name, 'Зомби');
  const reloaded = loadSettings(JSON.parse(JSON.stringify(applyPatch(renamed, {customEvents: {c_okay1: {name: 'Ок', icon: '✨', commands: 'say hi'}}}))));
  assert.equal(effectiveEvents(reloaded).find(item => item.code === 'zombie').name, 'Мертвяк');
  assert.equal(reloaded.customEvents.c_okay1.name, 'Ок');
});

test('строгая проверка значений из интерфейса', () => {
  const base = defaultSettings();
  assert.throws(() => applyPatch(base, {events: {zombie: {price: 0}}}), /Цена/);
  assert.throws(() => applyPatch(base, {events: {hacked: {price: 10}}}), /Неизвестное/);
  assert.throws(() => applyPatch(base, {currency: 'XXX'}), /валюта/);
  assert.throws(() => applyPatch(base, {minecraft: {player: 'Steve; op me'}}), /Ник/);
  assert.throws(() => applyPatch(base, {minecraft: {host: 'http://evil'}}), /Адрес/);
  assert.throws(() => applyPatch(base, {overlay: {color: 'red;display:none'}}), /Цвет/);
  assert.equal(applyPatch(base, {events: {zombie: {price: 20.555}}}).events.zombie.price, 21, 'цены только целые');
  assert.equal(base.events.zombie.price, 20, 'исходный объект не меняется');
});

test('повреждённые разделы с диска заменяются значениями по умолчанию', () => {
  const loaded = loadSettings({currency: 'USD', events: {zombie: {price: 33}, pig: {price: -1}}, overlay: 5, customEvents: {c_bad: {name: ''}}});
  assert.equal(loaded.currency, 'USD');
  assert.deepEqual(loaded.customEvents, {});
  assert.equal(loaded.events.zombie.price, 33);
  assert.equal(loaded.events.pig.price, 15);
  assert.equal(loaded.overlay.duration, 6);
});

test('совместная игра: правки двух стримеров сливаются, а не затирают друг друга', () => {
  const base = exportShared(defaultSettings());
  const host = exportShared(applyPatch(defaultSettings(), {
    customEvents: {c_0000beef: {name: 'Курица', icon: '🐔', desc: '', commands: 'summon minecraft:chicken ~ ~1 ~'}},
    events: {pig: {price: 10, enabled: true}}
  }));
  const world = exportShared(applyPatch(applyPatch(defaultSettings(), {events: {zombie: {price: 25, enabled: true, target: 'all'}}}), {queue: {delay: 15}}));
  const merged = mergeShared(base, host, world);
  assert.equal(merged.customEvents.c_0000beef.name, 'Курица', 'своё новое событие осталось');
  assert.equal(merged.events.pig.price, 10, 'своя правка цены осталась');
  assert.deepEqual([merged.events.zombie.price, merged.events.zombie.target], [25, 'all'], 'правка друга подтянулась');
  assert.deepEqual(merged.queue, {delay: 15});

  const removed = structuredClone(base);
  const withHen = mergeShared(base, base, host);
  assert.ok(withHen.customEvents.c_0000beef, 'новое событие друга появилось');
  assert.equal(mergeShared(host, host, removed).customEvents.c_0000beef, undefined, 'удаление другом тоже доходит');
  assert.deepEqual(mergeShared(null, host, world), host, 'без общей точки — свои настройки');
});
