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

test('цены по курсу: от 10 — целыми, меньше — до копеек', () => {
  assert.equal(convertPrice(199, 83.93), 2.37);
  assert.equal(convertPrice(199, 2.6), 77);
  assert.equal(convertPrice(20, 0.1859), 108);
});
