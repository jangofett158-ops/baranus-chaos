import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, applyPatch, loadSettings, effectiveEvents, priceIn} from '../lib/settings.mjs';

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

test('дополнительные валюты: цена по курсу, ручная цена, пересчёт и смена основной', () => {
  let s = applyPatch(defaultSettings(), {extraCurrencies: {USD: {}, EUR: {rate: 100}}});
  assert.equal(s.extraCurrencies.USD.rate, 90);
  assert.equal(priceIn(s, 'giantzombie', 'USD'), 2.21);  // 199 / 90
  assert.equal(priceIn(s, 'giantzombie', 'EUR'), 1.99);
  s = applyPatch(s, {events: {giantzombie: {price: 300}}});
  assert.equal(priceIn(s, 'giantzombie', 'EUR'), 3, 'цена по курсу следует за основной');
  s = applyPatch(s, {events: {giantzombie: {prices: {EUR: 4}}}});
  assert.equal(priceIn(s, 'giantzombie', 'EUR'), 4);
  assert.deepEqual(effectiveEvents(s).find(e => e.code === 'giantzombie').manual, ['EUR']);
  s = applyPatch(s, {recalcPrices: true});
  assert.equal(priceIn(s, 'giantzombie', 'EUR'), 3);
  assert.equal(priceIn(s, 'zombie', 'UAH'), null, 'не добавленная валюта не принимается');
  assert.throws(() => applyPatch(s, {events: {zombie: {prices: {UAH: 5}}}}), /не добавлена/);
  assert.throws(() => applyPatch(s, {extraCurrencies: {RUB: {}}}), /основная/);
  assert.equal(priceIn(applyPatch(defaultSettings(), {extraCurrencies: {KZT: {}}}), 'giantzombie', 'KZT'), 1106); // 199 / 0.18 → целое
  const switched = applyPatch(s, {currency: 'USD'});
  assert.equal(switched.extraCurrencies.USD, undefined);
  assert.equal(switched.extraCurrencies.EUR.rate, 1.0889);
  const reloaded = loadSettings(JSON.parse(JSON.stringify(applyPatch(s, {events: {zombie: {prices: {USD: 1}}}}))));
  assert.equal(priceIn(reloaded, 'zombie', 'USD'), 1);
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
  assert.equal(applyPatch(base, {events: {zombie: {price: 20.555}}}).events.zombie.price, 20.56);
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
