// Токен Implicit Grant приходит только во фрагменте адреса (#access_token=...) и не попадает в логи сервера.
const fragment = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
history.replaceState(null, '', '/oauth/callback');

const payload = {
  state: fragment.get('state') || query.get('state'),
  access_token: fragment.get('access_token'),
  expires_in: fragment.get('expires_in'),
  code: query.get('code'),
  error: fragment.get('error') || query.get('error'),
  error_description: fragment.get('error_description') || query.get('error_description')
};

function finish(ok, title, text) {
  document.getElementById('oauth-icon').textContent = ok ? '✅' : '⚠️';
  document.getElementById('oauth-title').textContent = title;
  document.getElementById('oauth-text').textContent = text;
}

(async () => {
  try {
    if (!payload.state && !payload.error) throw new Error('Нет данных входа. Нажмите «Войти через DonationAlerts» в приложении.');
    const response = await fetch('/api/da/session', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Baranus': '1'}, body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось подключиться.');
    finish(true, 'Готово!', 'DonationAlerts подключён. Эту вкладку можно закрыть и вернуться в Baranus Chaos.');
  } catch (error) {
    finish(false, 'Не получилось', error.message);
  }
})();
