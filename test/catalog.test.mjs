import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EFFECTS, CODES, MOD_CODES, CATEGORIES} from '../lib/catalog.mjs';

const java = fs.readFileSync(new URL('../forge-mod/src/main/java/site/baranus/chaos/ChaosEffects.java', import.meta.url), 'utf8');

test('коды событий уникальны, у каждого есть категория и иконка', () => {
  assert.equal(new Set(CODES).size, CODES.length);
  const categories = new Set(CATEGORIES.map(category => category.id));
  for (const effect of EFFECTS) {
    assert.ok(categories.has(effect.category), effect.code);
    assert.ok(effect.icon && effect.name && effect.desc, effect.code);
  }
});

test('базовые цены разные: каждая сумма соответствует одному событию', () => {
  const prices = EFFECTS.map(effect => effect.price);
  assert.equal(new Set(prices).size, prices.length);
});

test('каталог приложения совпадает с событиями Forge-мода', () => {
  const javaCodes = [...java.matchAll(/add\("([a-z0-9_]+)"/g)].map(match => match[1]);
  assert.deepEqual(javaCodes, [...MOD_CODES]);
  for (const code of MOD_CODES) assert.match(java, new RegExp(`case "${code}" ->`));
});
