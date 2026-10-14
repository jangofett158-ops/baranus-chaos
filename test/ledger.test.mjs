import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DonationLedger} from '../lib/ledger.mjs';
import {SecretStore} from '../lib/store.mjs';

test('донат с тем же ID не выполняется повторно даже после перезапуска', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-ledger-'));
  try {
    const file = path.join(dir, 'processed-donations.json');
    const ledger = new DonationLedger(file);
    assert.equal(ledger.reserve('100'), true);
    assert.equal(ledger.reserve('100'), false);
    assert.equal(new DonationLedger(file).reserve('100'), false);
    assert.throws(() => ledger.reserve('../evil'), /ID/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('старые записи удаляются по сроку и лимиту', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-ledger-'));
  try {
    let now = 1_000_000;
    const ledger = new DonationLedger(path.join(dir, 'l.json'), {now: () => now, maxEntries: 2, retentionMs: 100});
    ledger.reserve('a'); now += 1; ledger.reserve('b'); now += 1; ledger.reserve('c');
    assert.equal(ledger.has('a'), false);
    now += 500;
    ledger.reserve('d');
    assert.equal(ledger.has('b'), false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('секреты шифруются, если доступна защита', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baranus-secrets-'));
  try {
    const protector = {encrypt: text => Buffer.from(text).reverse().toString('base64'), decrypt: data => Buffer.from(data, 'base64').reverse().toString()};
    const file = path.join(dir, 'secrets.json');
    new SecretStore(file, protector).set('rconPassword', 'очень-секретно');
    assert.equal(fs.readFileSync(file, 'utf8').includes('очень-секретно'), false);
    assert.equal(new SecretStore(file, protector).get('rconPassword'), 'очень-секретно');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
