import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRates} from '../lib/rates.mjs';
import {convertPrice} from '../lib/settings.mjs';

test('курсы: сколько основной валюты стоит 1 единица другой', async () => {
  const fetchImpl = async () => ({ok: true, json: async () => ({result: 'success', time_last_update_unix: 100,
    rates: {RUB: 1, USD: 0.011915, KZT: 5.379256, XXX: 0}})});
  const {rates, updatedAt} = await fetchRates('RUB', ['USD', 'KZT', 'XXX', 'EUR'], fetchImpl);
  assert.deepEqual(rates, {USD: 83.9278, KZT: 0.1859});
  assert.equal(updatedAt, 100_000);
  await assert.rejects(() => fetchRates('RUB', ['USD'], async () => ({ok: false, status: 503})), /503/);
  await assert.rejects(() => fetchRates('RUB', ['USD'], async () => ({ok: true, json: async () => ({result: 'error'})})), /ошибку/);
});

test('цены по курсу оканчиваются на 0 или 5 (вверх), минимум 5', () => {
  assert.equal(convertPrice(50, 1.8616), 30);   // 26,9 ₴ → 30 ₴
  assert.equal(convertPrice(50, 83.93), 5);     // 0,6 $ → 5 $
  assert.equal(convertPrice(199, 2.6), 80);     // 76,5 → 80
  assert.equal(convertPrice(20, 0.1859), 110);  // 107,6 → 110
  assert.equal(convertPrice(150, 10), 15, 'ровно 15 остаётся 15');
});
