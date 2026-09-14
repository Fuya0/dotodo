const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  shell: electronShell
} = require('electron');
const { createState } = require('./domain/state-schema');
const { createDailyTodoEngine } = require('./domain/daily-todo-engine');
const { JsonStateStore } = require('./infrastructure/json-state-store');
const { registerIpc } = require('./electron/ipc');
const { formatLocalInstant } = require('./electron/local-time');
const { createShellController } = require('./electron/shell-controller');
const { createWindowController } = require('./electron/window-controller');

let engine = null;
let store = null;
let windowController = null;
let shellController = null;
let ipcRegistration = null;
const isSmokeTest = process.argv.includes('--smoke-test');
const printPaths = process.argv.includes('--print-paths');
const captureTarget = readArgument('--capture=');
const captureBackdrop = readArgument('--capture-backdrop=');
const capturePage = readArgument('--capture-page=');
// 在渲染进程里执行一段脚本，把它返回的结果打到标准输出。
// 这是 test/ui/ 里那些交互场景的入口：它们真的去点、去按键，然后断言 DOM。
const driveScript = readArgument('--drive=');
const trayIconPath = path.join(__dirname, '..', 'assets', 'tray.png');
const runtimeWarnings = [];
let hasUnsavedChanges = false;
let currentSaveError = null;

function readArgument(prefix) {
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

if (isSmokeTest) {
  const isolatedUserData = process.env.DOTODO_SMOKE_USER_DATA;
  if (!isolatedUserData || !path.isAbsolute(isolatedUserData)) {
    console.error('[DoTodo smoke] 缺少绝对路径 DOTODO_SMOKE_USER_DATA。');
    app.exit(2);
  } else {
    app.setPath('userData', isolatedUserData);
  }
}
// 诊断模式必须在单实例锁之前退出：如果用户已经开着应用，
// 拿不到锁就什么也打印不出来，而这个模式正是用来回答「数据到底存在哪」的。
const hasSingleInstanceLock = printPaths ? true : app.requestSingleInstanceLock();
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

        if (driveScript) {
          // 等界面完成首次渲染再开始驱动，否则第一批选择器可能还查不到元素。
          await new Promise((resolve) => setTimeout(resolve, 400));
          const source = fs.readFileSync(driveScript, 'utf8');
          const outcome = await smokeWindow.webContents.executeJavaScript(
            `(async () => {\n${source}\n})()`
          );
          console.log(`DOTODO_DRIVE_RESULT ${JSON.stringify(outcome)}`);
        }

        if (captureTarget) {
          if (capturePage) {
            await smokeWindow.webContents.executeJavaScript(
              `document.querySelector('.tab[data-page=${JSON.stringify(capturePage)}]')?.click(); true`
            );
          }
          // 让字体、布局和入场动画先落定，否则截到的是半成品。
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (captureBackdrop) {
            await smokeWindow.webContents.executeJavaScript(
              `document.documentElement.style.background = ${JSON.stringify(captureBackdrop)}; true`
            );
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          const image = await smokeWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(captureTarget), { recursive: true });
          fs.writeFileSync(captureTarget, image.toPNG());
          console.log(`DOTODO_CAPTURE_WRITTEN ${captureTarget}`);
        }

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
      const result = shellController.setWindowMode(mode);
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    setLaunchAtLogin(enabled) {
      const result = shellController.setLaunchAtLogin(enabled);
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    minimize: () => windowController.minimize(),
    close: () => windowController.close(),
    // 设置写盘之后才让托盘菜单读新值，否则菜单会显示成旧状态。
    syncSettings: () => shellController.refreshMenu()
  });
}

function persistSettings(patch) {
  const result = engine.updateSettings(patch);
  if (!result.ok) throw new Error(result.error);
  store.save(result.snapshot);
  markSaved();
  return result.snapshot;
}

/**
 * 托盘菜单发出的意图。和 IPC 路径的区别是这里没有渲染进程参与，
 * 所以组合根要自己完成「先让系统生效，再写盘，最后刷新菜单」。
 */
async function handleShellIntent(intent) {
  try {
    if (intent.type === 'window-mode') {
      const applied = shellController.setWindowMode(intent.mode);
      if (!applied.ok) throw new Error(applied.error);
      persistSettings({ windowMode: intent.mode });
    } else if (intent.type === 'launch-at-login') {
      // 系统拒绝时抛错，于是这一项永远不会被写进配置。
      const applied = shellController.setLaunchAtLogin(intent.enabled);
      if (!applied.ok) throw new Error(applied.error);
      persistSettings({ launchAtLogin: intent.enabled });
    } else if (intent.type === 'close-to-tray') {
      persistSettings({ closeToTray: intent.enabled });
    }
  } catch (error) {
    console.error('[DoTodo shell]', error);
    addWarning(`托盘操作没有生效：${error.message}`);
  } finally {
    shellController.refreshMenu();
  }
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
  // 恢复过程的证据要说到具体路径：只告诉用户「文件损坏了」等于让他自己去翻目录。
  for (const preservedPath of loaded.preservedCorruptFiles) {
    addWarning(`损坏的原文件已保留在：${preservedPath}`);
  }
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

  shellController = createShellController({
    app,
    Tray,
    Menu,
    globalShortcut,
    iconPath: trayIconPath,
    platform: process.platform,
    getWindow: () => windowController.getWindow(),
    getSettings: () => engine.getSnapshot().settings,
    onCommand: handleShellIntent,
    onError: (error) => console.error('[DoTodo shell]', error)
  });
  const shellBoot = shellController.initialize();
  for (const warning of shellBoot.warnings) addWarning(warning);
  if (shellBoot.shortcut.warning) console.info(`[DoTodo shell] ${shellBoot.shortcut.warning}`);

  // 冒烟与交互场景都会用到这一行：托盘建起来了没有、快捷键拿没拿到。
  // 托盘图标在打包后是从 asar 里读的，这条输出是唯一能证明那条路径解析成功的证据。
  if (isSmokeTest) {
    console.log(`DOTODO_SHELL_BOOT ${JSON.stringify({
      trayCreated: shellBoot.trayCreated,
      shortcut: shellBoot.shortcut,
      warnings: shellBoot.warnings
    })}`);
  }

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

if (printPaths) {
  // 用户迟早会问「我的清单存在哪个文件」。与其靠文档里的一句话，不如让应用自己回答。
  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    console.log(JSON.stringify({
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      appData: app.getPath('appData'),
      userData,
      stateFile: path.join(userData, 'state.json'),
      backupFile: path.join(userData, 'state.backup.json'),
      executable: app.getPath('exe')
    }, null, 2));
    app.exit(0);
  });
} else if (hasSingleInstanceLock) {
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
  shellController?.dispose();
  windowController?.dispose();
});
