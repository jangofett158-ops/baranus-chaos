const {app, BrowserWindow, Menu, Tray, shell, dialog, safeStorage} = require('electron');
const path = require('path');

const PORT = 3217;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let win = null, tray = null, popout = null;
// Окно закрывается в фон (значок у часов); выходим только из меню значка или при выключении Windows.
let quitting = false, trayHintShown = false;

function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' || target.origin === ORIGIN) shell.openExternal(url);
  } catch { /* некорректная ссылка */ }
}

const POPOUT_OPTIONS = {
  width: 560, height: 760, minWidth: 440, minHeight: 420, backgroundColor: '#0b0809', title: 'Ивенты - Baranus Chaos',
  autoHideMenuBar: true, icon: path.join(__dirname, 'public', 'icon.png'),
  webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}
};

/** Ссылки наружу — в системный браузер; окно ивентов (?popout=events) — отдельным окном приложения. */
function guard(contents) {
  contents.setWindowOpenHandler(({url}) => {
    if (url.startsWith(ORIGIN + '/?popout=')) return {action: 'allow', overrideBrowserWindowOptions: POPOUT_OPTIONS};
    openExternal(url);
    return {action: 'deny'};
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); openExternal(url); }
  });
}

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Окно ивентов из меню значка: одно, повторный выбор просто показывает его. */
function openPopout() {
  if (popout && !popout.isDestroyed()) { popout.show(); popout.focus(); return; }
  popout = new BrowserWindow(POPOUT_OPTIONS);
  popout.setMenuBarVisibility(false);
  guard(popout.webContents);
  popout.loadURL(ORIGIN + '/?popout=events');
}

/** Запрос к своему же локальному API (пауза из меню значка). */
async function api(route, body) {
  const response = await fetch(ORIGIN + route, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Baranus': '1'}, body: JSON.stringify(body)});
  return response.json();
}

/** Значок у часов: щелчок - открыть окно, правая кнопка - меню (пауза хаоса берётся из приложения в момент открытия). */
function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('Baranus Chaos - работает в фоне');
  tray.on('click', focusWindow);
  tray.on('right-click', async () => {
    let paused = false;
    try { paused = !!(await api('/api/state')).settings?.paused; } catch { /* сервер ещё запускается */ }
    tray.popUpContextMenu(Menu.buildFromTemplate([
      {label: 'Открыть Baranus Chaos', click: focusWindow},
      {label: 'Окно ивентов', click: openPopout},
      {type: 'separator'},
      {label: paused ? 'Включить хаос' : 'Пауза хаоса', click: () => api('/api/settings', {paused: !paused}).catch(() => {})},
      {type: 'separator'},
      {label: 'Выйти', click: () => { quitting = true; app.quit(); }}
    ]));
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', focusWindow);
  app.on('before-quit', () => { quitting = true; });
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
      guard(win.webContents);
      createTray();
      // Крестик прячет окно в фон: донаты продолжают приходить, ивенты - срабатывать.
      win.on('close', event => {
        if (quitting) return;
        event.preventDefault();
        win.hide();
        if (!trayHintShown) {
          trayHintShown = true;
          tray.displayBalloon({iconType: 'info', title: 'Baranus Chaos работает в фоне',
            content: 'Донаты продолжают приходить. Открыть окно или выйти - значок у часов.'});
        }
      });
      // «Выгрузить ивенты»: окно сохранения сразу открывается в «Документах».
      win.webContents.session.on('will-download', (event, item) => {
        item.setSaveDialogOptions({title: 'Сохранить ивенты', defaultPath: path.join(app.getPath('documents'), item.getFilename()),
          filters: [{name: 'Ивенты Baranus Chaos', extensions: ['json']}]});
      });
      // «События в отдельном окне» — окно приложения, а не внешний браузер.
      win.webContents.on('did-create-window', child => {
        child.setMenuBarVisibility(false);
        guard(child.webContents);
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
  // Без окон приложение продолжает работать в фоне со значком у часов.
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}
