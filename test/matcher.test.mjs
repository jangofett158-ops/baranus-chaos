import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, applyPatch} from '../lib/settings.mjs';
import {matchDonation, normalizeDonation, extractDonation, resolveRandom, codesIn} from '../lib/matcher.mjs';

const settings = defaultSettings();
const donation = (amount, extra = {}) => normalizeDonation({id: 1, amount, currency: 'RUB', username: 'Вася', message: '', ...extra});

test('точная сумма запускает событие с этой ценой', () => {
  assert.deepEqual(matchDonation(donation(20), settings), {code: 'zombie', via: 'amount', pool: 1});
  assert.equal(matchDonation(donation(149), settings).code, 'golem');
  assert.equal(matchDonation(donation('49.00'), settings).code, 'heal');
});

test('сумма без события — обычный донат', () => {
  assert.match(matchDonation(donation(21), settings).reason, /не совпадает/);
});

test('только точная сумма: больше цены — не срабатывает', () => {
  assert.match(matchDonation(donation(5000), settings).reason, /не совпадает/);
});

test('своё событие срабатывает по своей цене и попадает в случайные', () => {
  const custom = applyPatch(settings, {customEvents: {c_party: {name: 'Вечеринка', icon: '🎉', commands: 'say {donor}'}}});
  const priced = applyPatch(custom, {events: {c_party: {price: 333}}});
  assert.deepEqual(matchDonation(donation(333), priced), {code: 'c_party', via: 'amount', pool: 1});
  const onlyCustom = applyPatch(priced, {events: Object.fromEntries(Object.keys(priced.events).map(code => [code, {enabled: code === 'c_party' || code === 'random'}]))});
  assert.equal(resolveRandom('random', onlyCustom, () => 0.3), 'c_party');
});

test('одинаковая цена — случайное событие из нескольких', () => {
  const same = applyPatch(settings, {events: {zombie: {price: 15}}}); // как у свинки
  assert.deepEqual(matchDonation(donation(15), same, () => 0), {code: 'pig', via: 'amount', pool: 2});
  assert.equal(matchDonation(donation(15), same, () => 0.99).code, 'zombie');
});

test('выключенные события не срабатывают', () => {
  const off = applyPatch(settings, {events: {zombie: {enabled: false}}});
  assert.equal(matchDonation(donation(20), off).code, undefined);
});

test('код в сообщении выбирает событие, если хватает суммы', () => {
  assert.deepEqual(matchDonation(donation(100, {message: 'держи !creeper'}), settings), {code: 'creeper', via: 'code', pool: 1});
  assert.match(matchDonation(donation(20, {message: '!creeper'}), settings).reason, /нужно 60/);
  const noCodes = applyPatch(settings, {codeTrigger: false});
  assert.equal(matchDonation(donation(20, {message: '!creeper'}), noCodes).code, 'zombie');
  assert.deepEqual(codesIn('!Zombie, ура !pig.'), ['zombie', 'pig']);
});

test('донат в другой валюте использует amount_in_user_currency', () => {
  assert.equal(matchDonation(normalizeDonation({id: 2, amount: 0.25, currency: 'USD', amount_in_user_currency: 20}), settings).code, 'zombie');
  assert.match(matchDonation(normalizeDonation({id: 3, amount: 1, currency: 'USD'}), settings).reason, /USD/);
});

test('донаты в разных валютах: своя цена в каждой валюте, у долларов - с копейками', () => {
  let multi = applyPatch(settings, {extraCurrencies: {USD: {rate: 80}}});
  // Голем 149 ₽ → 1,8625 $ → 1,87 $, зомби 20 ₽ → 0,25 $
  assert.equal(matchDonation(normalizeDonation({id: 5, amount: 1.87, currency: 'USD'}), multi).code, 'golem');
  assert.equal(matchDonation(normalizeDonation({id: 6, amount: 0.25, currency: 'USD'}), multi).code, 'zombie');
  assert.equal(matchDonation(normalizeDonation({id: 9, amount: 1.86, currency: 'USD'}), multi).code, undefined, 'на цент меньше - не совпадает');
  // Ручная цена в долларах
  multi = applyPatch(multi, {events: {golem: {prices: {USD: 2.5}}}});
  assert.equal(matchDonation(normalizeDonation({id: 7, amount: 2.5, currency: 'USD'}), multi).code, 'golem');
  // Валюта не добавлена и нет пересчёта от DonationAlerts
  assert.match(matchDonation(normalizeDonation({id: 8, amount: 5, currency: 'EUR'}), multi).reason, /EUR.*не добавлена/);
});

test('случайное событие выбирает из включённых событий мода', () => {
  const only = applyPatch(settings, {events: Object.fromEntries(Object.keys(settings.events).map(code => [code, {enabled: code === 'pig' || code === 'random'}]))});
  assert.equal(resolveRandom('random', only, () => 0.5), 'pig');
  assert.equal(resolveRandom('zombie', only), 'zombie');
});

test('донат в обёртке Centrifugo и отбраковка мусора', () => {
  const raw = {seq: 4, data: {id: 77, name: 'donation', username: 'Аня', message: 'привет', amount: 20, currency: 'RUB'}};
  assert.equal(extractDonation(raw).id, '77');
  assert.equal(normalizeDonation({id: {x: 1}, amount: 20, currency: 'RUB'}), null);
  assert.equal(normalizeDonation({id: 1, amount: -5, currency: 'RUB'}), null);
  assert.equal(normalizeDonation({id: 1, amount: 5, currency: 'рубли'}), null);
});
