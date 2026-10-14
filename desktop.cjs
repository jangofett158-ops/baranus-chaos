const {app, BrowserWindow, shell, dialog, safeStorage} = require('electron');
const path = require('path');

const PORT = 3217;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let win = null;

function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' || target.origin === ORIGIN) shell.openExternal(url);
  } catch { /* некорректная ссылка */ }
}

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', focusWindow);
  app.whenReady().then(async () => {
    try {
      // Пароль RCON и токен DonationAlerts шифруются учётной записью Windows (DPAPI).
      const protector = safeStorage.isEncryptionAvailable() ? {
        encrypt: text => safeStorage.encryptString(text).toString('base64'),
        decrypt: data => safeStorage.decryptString(Buffer.from(data, 'base64'))
      } : null;
      const {start} = await import('./server.mjs');
      const dataDir = process.env.BARANUS_DATA_DIR || path.join(app.getPath('userData'), 'data');
      const server = await start({dataDir, port: PORT, protector});
      server.events.on('da-connected', focusWindow);

      win = new BrowserWindow({
        show: !process.env.BARANUS_SMOKE_REPORT,
        width: 1360, height: 880, minWidth: 1080, minHeight: 700,
        backgroundColor: '#0b0809', title: 'Baranus Chaos', autoHideMenuBar: true,
        icon: path.join(__dirname, 'public', 'icon.png'),
        webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}
      });
      win.webContents.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'}; });
      win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); openExternal(url); }
      });
      await win.loadURL(ORIGIN + '/');
      if (process.env.BARANUS_SMOKE_REPORT) {
        require('fs').writeFileSync(process.env.BARANUS_SMOKE_REPORT, 'OK: server started, window loaded');
        app.quit();
      }
    } catch (error) {
      dialog.showErrorBox('Не удалось запустить Baranus Chaos',
        `${error.message}\n\nЕсли порт ${PORT} занят, закройте другую копию приложения (в том числе старую версию 0.4.0).`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
