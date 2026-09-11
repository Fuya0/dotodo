const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { JsonStore } = require('./store');

let mainWindow;
let store;
let boundsSaveTimer;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function saveBoundsSoon() {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set({ windowBounds: mainWindow.getBounds() });
    }
  }, 250);
}

function createWindow() {
  const state = store.get();
  mainWindow = new BrowserWindow({
    ...state.windowBounds,
    minWidth: 330,
    minHeight: 420,
    maxWidth: 720,
    maxHeight: 900,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: state.alwaysOnTop,
    hasShadow: true,
    show: false,
    title: 'DoTodo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setOpacity(state.opacity);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.argv.includes('--smoke-test')) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(() => app.quit(), 1200));
  }
  mainWindow.on('move', saveBoundsSoon);
  mainWindow.on('resize', saveBoundsSoon);
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    ...store.get(),
    darkMode: nativeTheme.shouldUseDarkColors
  }));

  ipcMain.handle('state:save-todos', (_event, todos) => store.set({ todos }).todos);

  ipcMain.handle('window:set-opacity', (_event, opacity) => {
    const next = store.set({ opacity });
    mainWindow.setOpacity(next.opacity);
    return next.opacity;
  });

  ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
    const value = Boolean(enabled);
    mainWindow.setAlwaysOnTop(value, 'floating');
    store.set({ alwaysOnTop: value });
    return value;
  });

  ipcMain.handle('app:set-launch-at-login', (_event, enabled) => {
    const value = Boolean(enabled);
    app.setLoginItemSettings({ openAtLogin: value });
    store.set({ launchAtLogin: value });
    return value;
  });

  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:close', () => mainWindow.close());
}

app.whenReady().then(() => {
  store = new JsonStore(path.join(app.getPath('userData'), 'state.json'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
