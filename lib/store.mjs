import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {encoding: 'utf8', mode: 0o600});
  fs.renameSync(temp, file);
}

/**
 * Секреты (пароль RCON, токен DonationAlerts). В EXE шифруются через Electron safeStorage
 * (защита учётной записью Windows). При запуске через `node server.mjs` хранятся как есть.
 */
export class SecretStore {
  constructor(file, protector = null) {
    this.file = file;
    this.protector = protector;
    this.values = {};
    const raw = readJson(file, null);
    try {
      if (raw?.protected && protector) this.values = JSON.parse(protector.decrypt(raw.data));
      else if (raw && !raw.protected && raw.data && typeof raw.data === 'object') this.values = raw.data;
    } catch {
      this.values = {}; // зашифровано другим пользователем Windows — нужно ввести заново
    }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (value === undefined || value === null || value === '') delete this.values[key];
    else this.values[key] = value;
    const data = JSON.stringify(this.values);
    writeJson(this.file, this.protector ? {protected: true, data: this.protector.encrypt(data)} : {protected: false, data: this.values});
  }
}
