const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, dialog, ipcMain, shell: electronShell } = require('electron');
const { createState } = require('./domain/state-schema');
const { createDailyTodoEngine } = require('./domain/daily-todo-engine');
const { JsonStateStore } = require('./infrastructure/json-state-store');
const { registerIpc } = require('./electron/ipc');
const { formatLocalInstant } = require('./electron/local-time');
const { createWindowController } = require('./electron/window-controller');

let engine = null;
let store = null;
let windowController = null;
let ipcRegistration = null;
const isSmokeTest = process.argv.includes('--smoke-test');
const runtimeWarnings = [];
let hasUnsavedChanges = false;
let currentSaveError = null;

if (isSmokeTest) {
  const isolatedUserData = process.env.DOTODO_SMOKE_USER_DATA;
  if (!isolatedUserData || !path.isAbsolute(isolatedUserData)) {
    console.error('[DoTodo smoke] 缺少绝对路径 DOTODO_SMOKE_USER_DATA。');
    app.exit(2);
  } else {
    app.setPath('userData', isolatedUserData);
  }
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  if (isSmokeTest) app.exit(2);
  else app.quit();
}

function addWarning(message) {
  if (message && !runtimeWarnings.includes(message)) runtimeWarnings.push(message);
}

function markSaveFailure(error) {
  hasUnsavedChanges = true;
  currentSaveError = `数据暂时只保存在内存中：${error.message}`;
}

function markSaved() {
  hasUnsavedChanges = false;
  currentSaveError = null;
}

function getRuntimeStatus() {
  return {
    warnings: currentSaveError ? [...runtimeWarnings, currentSaveError] : [...runtimeWarnings],
    dirty: hasUnsavedChanges
  };
}

function persistBounds(bounds) {
  const result = engine.updateWindowBounds(bounds);
  if (!result.ok) throw new Error(result.error);
  try {
    store.save(result.snapshot);
    markSaved();
  } catch (error) {
    markSaveFailure(error);
    throw error;
  }
}

function createAppWindow() {
  const snapshot = engine.getSnapshot();
  windowController = createWindowController({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    htmlPath: path.join(__dirname, 'renderer', 'index.html'),
    bounds: snapshot.windowBounds,
    windowMode: snapshot.settings.windowMode,
    onBoundsChanged: persistBounds,
    onError: (error) => console.error('[DoTodo window]', error)
  });

  if (isSmokeTest) {
    const smokeWindow = windowController.getWindow();
    let finished = false;
    const timeout = setTimeout(() => finishSmoke(1, 'Renderer 启动超时。'), 10_000);
    function finishSmoke(code, message) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (message) console.error(`[DoTodo smoke] ${message}`);
      app.exit(code);
    }
    smokeWindow.webContents.once('did-fail-load', (_event, code, description) => {
      finishSmoke(1, `页面加载失败 ${code}: ${description}`);
    });
    smokeWindow.webContents.once('render-process-gone', (_event, details) => {
      finishSmoke(1, `Renderer 异常退出：${details.reason}`);
    });
    smokeWindow.webContents.once('did-finish-load', async () => {
      try {
        const ready = await smokeWindow.webContents.executeJavaScript(`
          (async () => {
            const state = await window.dotodo.getSnapshot();
            const dateLabel = document.querySelector('#dateLabel')?.textContent ?? '';
            const progress = document.querySelector('#progressLabel')?.textContent ?? '';
            return Boolean(
              state?.activeDay?.date &&
              document.querySelector('#todoForm') &&
              document.querySelector('#todoList') &&
              document.querySelector('#settingsPanel') &&
              dateLabel.length > 0 &&
              /^\\d+ \\/ \\d+$/.test(progress)
            );
          })()
        `);
        if (!ready) throw new Error('Renderer 或 Preload 未准备完成。');
        console.log('DOTODO_SMOKE_READY');
        finishSmoke(0);
      } catch (error) {
        finishSmoke(1, error.message);
      }
    });
  }
  return windowController;
}

function createDialogs() {
  return Object.freeze({
    async chooseImportPath() {
      const result = await dialog.showOpenDialog({
        title: '导入 DoTodo 数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      return result.canceled ? null : result.filePaths[0];
    },
    async chooseExportPath() {
      const date = engine.getSnapshot().activeDay.date;
      const result = await dialog.showSaveDialog({
        title: '导出 DoTodo 数据',
        defaultPath: `DoTodo-${date}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      return result.canceled ? null : result.filePath;
    }
  });
}

function createShellAdapter() {
  return Object.freeze({
    openPath: (directory) => electronShell.openPath(directory),
    setWindowMode(mode) {
      if (mode === 'desktop') throw new Error('桌面模式将在原生壳层阶段启用。');
      const window = windowController.getWindow();
      window.setAlwaysOnTop(mode === 'topmost', 'floating');
    },
    setLaunchAtLogin(enabled) {
      app.setLoginItemSettings({ openAtLogin: enabled });
    },
    minimize: () => windowController.minimize(),
    close: () => windowController.close()
  });
}

function prepareCurrentDay() {
  const result = engine.ensureCurrentDay(formatLocalInstant());
  if (!result.ok) return result;
  if (result.warning) addWarning(result.warning);
  if (result.rolledOver) {
    try {
      store.save(result.snapshot);
      markSaved();
    } catch (error) {
      markSaveFailure(error);
      return {
        ok: false,
        error: `跨日状态保存失败：${error.message}`,
        snapshot: result.snapshot
      };
    }
  }
  return { ok: true, snapshot: result.snapshot };
}

async function initialize() {
  store = new JsonStateStore(app.getPath('userData'));
  const loaded = store.load();
  if (loaded.warning) addWarning(loaded.warning);
  if (!loaded.writable) hasUnsavedChanges = true;
  const now = formatLocalInstant();
  const initialState = loaded.state || createState(now.slice(0, 10));
  engine = createDailyTodoEngine(initialState, {
    now: formatLocalInstant,
    createId: () => crypto.randomUUID()
  });

  const dateResult = engine.ensureCurrentDay(now);
  if (!dateResult.ok) throw new Error(dateResult.error);
  if (dateResult.warning) addWarning(dateResult.warning);
  if (store.writable && (!loaded.state || dateResult.rolledOver || loaded.warning)) {
    try {
      store.save(dateResult.snapshot);
      markSaved();
    } catch (error) {
      markSaveFailure(error);
    }
  }

  createAppWindow();
  ipcRegistration = registerIpc({
    ipcMain,
    engine,
    store,
    dialogs: createDialogs(),
    shell: createShellAdapter(),
    status: {
      getStatus: getRuntimeStatus,
      markSaved,
      markDirty: markSaveFailure
    },
    prepareState: prepareCurrentDay
  });
  await windowController.load();
}

if (hasSingleInstanceLock) {
  app.whenReady().then(initialize).catch((error) => {
    console.error('[DoTodo startup]', error);
    app.exit(1);
  });
}

app.on('activate', () => {
  if (engine && BrowserWindow.getAllWindows().length === 0) {
    createAppWindow().load().catch((error) => console.error('[DoTodo activate]', error));
  }
});

app.on('second-instance', () => windowController?.show());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  ipcRegistration?.dispose();
  windowController?.dispose();
});
