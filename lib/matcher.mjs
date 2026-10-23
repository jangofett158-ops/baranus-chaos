import {MOD_CODES, effectByCode} from './catalog.mjs';
import {effectiveEvents} from './settings.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const cents = value => Math.round(Number(value) * 100);

/** Приводит донат DonationAlerts к единому виду. Возвращает null для любых сомнительных данных. */
export function normalizeDonation(input) {
  if (!input || typeof input !== 'object') return null;
  const id = typeof input.id === 'number' && Number.isSafeInteger(input.id) ? String(input.id) : input.id;
  const amount = Number(input.amount);
  const currency = String(input.currency ?? '').toUpperCase();
  if (typeof id !== 'string' || !ID_RE.test(id) || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const inUserCurrency = Number(input.amount_in_user_currency);
  return {
    id,
    amount,
    currency,
    amountInUserCurrency: Number.isFinite(inUserCurrency) && inUserCurrency > 0 ? inUserCurrency : null,
    username: String(input.username ?? '').trim().slice(0, 64) || 'Зритель',
    message: String(input.message ?? '').slice(0, 2000)
  };
}

/** Донат может прийти в обёртках Centrifugo ({seq, data:{...}}) — ищем его на небольшой глубине. */
export function extractDonation(value, depth = 0) {
  if (depth > 4 || !value || typeof value !== 'object') return null;
  const donation = normalizeDonation(value);
  if (donation) return donation;
  for (const key of ['data', 'payload', 'donation', 'result', 'params', 'pub']) {
    const found = value[key] && extractDonation(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * В какой валюте сравнивать донат: в его собственной, если она основная или добавлена в настройках;
 * иначе — в основной по amount_in_user_currency от DonationAlerts. null — сравнить нельзя.
 */
export function donationCurrency(donation, settings) {
  if (donation.currency === settings.currency || settings.extraCurrencies?.[donation.currency])
    return {currency: donation.currency, amount: donation.amount};
  if (donation.amountInUserCurrency != null) return {currency: settings.currency, amount: donation.amountInUserCurrency};
  return null;
}

/**
 * Выбирает событие для доната.
 * Срабатывает событие, цена которого точно равна сумме доната.
 * Если у нескольких событий одинаковая цена, выбирается одно из них случайно.
 */
export function matchDonation(donation, settings, random = Math.random) {
  const target = donationCurrency(donation, settings);
  if (!target) return {reason: `Донат в ${donation.currency}: эта валюта не добавлена в настройках ивентов.`};
  const {currency, amount} = target;
  const enabled = effectiveEvents(settings).filter(effect => effect.enabled);
  if (!enabled.length) return {reason: 'Все ивенты выключены.'};
  const priceOf = effect => currency === settings.currency ? effect.price : effect.prices[currency];

  // Только точная сумма: донат равен цене события в валюте доната.
  const pool = enabled.filter(effect => cents(priceOf(effect)) === cents(amount));
  if (!pool.length) return {reason: `Сумма ${amount} ${currency} не совпадает с ценой ивента.`};
  const pick = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return {code: pick.code, via: 'amount', pool: pool.length};
}

/** Для «Случайного события»: любое включённое событие (встроенное или своё), иначе любое встроенное. */
export function resolveRandom(code, settings, random = Math.random) {
  if (code !== 'random') return code;
  const enabled = effectiveEvents(settings).filter(effect => effect.enabled && effect.code !== 'random').map(effect => effect.code);
  const pool = enabled.length ? enabled : MOD_CODES;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export function describe(code, settings) {
  const effect = settings ? effectiveEvents(settings).find(item => item.code === code) : effectByCode(code);
  return effect ? {code, name: effect.name, icon: effect.icon} : {code, name: code, icon: '✨'};
}
