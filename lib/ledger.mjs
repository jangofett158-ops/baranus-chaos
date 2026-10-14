import fs from 'node:fs';
import {writeJson} from './store.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Журнал обработанных ID донатов. ID записывается ДО запуска события, поэтому переподключение
 * или перезапуск приложения не выполнят один донат дважды.
 */
export class DonationLedger {
  constructor(file, {now = Date.now, maxEntries = 20_000, retentionMs = 90 * 86_400_000} = {}) {
    Object.assign(this, {file, now, maxEntries, retentionMs});
    this.records = new Map();
    let saved = [];
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(saved)) saved = [];
    } catch { saved = []; }
    for (const item of saved) if (typeof item?.id === 'string' && Number.isFinite(item.at)) this.records.set(item.id, item.at);
    this.prune();
  }

  prune() {
    const oldest = this.now() - this.retentionMs;
    for (const [id, at] of this.records) if (at < oldest) this.records.delete(id);
    if (this.records.size > this.maxEntries)
      this.records = new Map([...this.records].sort((a, b) => a[1] - b[1]).slice(-this.maxEntries));
  }

  has(id) { return this.records.has(String(id)); }

  /** true — донат новый и теперь зарезервирован; false — уже обрабатывался. */
  reserve(id) {
    id = String(id);
    if (!ID_RE.test(id)) throw new Error('Неверный ID доната.');
    if (this.records.has(id)) return false;
    this.records.set(id, this.now());
    this.prune();
    writeJson(this.file, [...this.records].map(([key, at]) => ({id: key, at})));
    return true;
  }
}
