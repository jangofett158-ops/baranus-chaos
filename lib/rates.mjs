// Актуальные курсы валют: бесплатный ExchangeRate-API (без ключа, обновляется раз в сутки).
export const RATES_SOURCE = 'ExchangeRate-API';
const ratesUrl = base => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;

/**
 * Курсы к основной валюте: {USD: 83.93} — сколько основной валюты стоит 1 единица валюты.
 * Возвращает только запрошенные валюты с корректными значениями.
 */
export async function fetchRates(main, currencies, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(ratesUrl(main), {headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error(`Сервис курсов ответил HTTP ${response.status}.`);
  const data = await response.json();
  if (data?.result !== 'success' || !data.rates) throw new Error('Сервис курсов вернул ошибку.');
  const rates = {};
  for (const currency of currencies) {
    const perMain = Number(data.rates[currency]);
    if (Number.isFinite(perMain) && perMain > 0) rates[currency] = Math.round((1 / perMain) * 10000) / 10000;
  }
  const updatedAt = Number(data.time_last_update_unix) > 0 ? Number(data.time_last_update_unix) * 1000 : Date.now();
  return {rates, updatedAt};
}
