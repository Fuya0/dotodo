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
  screen,
  shell: electronShell
} = require('electron');
const { createState } = require('./domain/state-schema');
const { createDailyTodoEngine } = require('./domain/daily-todo-engine');
const { JsonStateStore } = require('./infrastructure/json-state-store');
const { registerIpc } = require('./electron/ipc');
const { formatLocalInstant, millisecondsUntilNextMidnight } = require('./electron/local-time');
const { createShellController } = require('./electron/shell-controller');
const { createWindowController } = require('./electron/window-controller');
const { createDesktopLayer } = require('./electron/desktop-layer');

/** 主进程主动推快照用的频道。它不走 invoke/handle，所以不在 ipc.js 的 CHANNELS 表里。 */
const SNAPSHOT_CHANNEL = 'state:changed';

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

// 桌面层：把窗口挂进 Windows 桌面，让它成为桌面的一部分，而不是一块浮在桌面之上的窗口。
//
// 冒烟和交互场景（`--smoke-test` / `--drive=`）会开出真窗口逐个断言，窗口一旦挂进
// 桌面就脱离了顶层窗口列表，那些断言全都会扑空 —— 所以测试入口下一律不挂。
const desktopLayer = isSmokeTest || driveScript
  ? createDesktopLayer({ native: null })
  : createDesktopLayer();
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
// Chromium 会在 userData 里铺开十来个自己的目录（Cache、GPUCache、Local Storage、
// Network、Dictionaries……）。它们跟我们的数据无关，混在一起的结果是用户打开数据目录
// 一眼看到一堆看不懂的东西，还得从里面找 state.json。
//
// Electron 的 `sessionData` 默认就等于 userData，这些缓存全挂在它下面。把它指到
// 子目录之后，数据目录顶层只剩三样：state.json（清单）、state.backup.json（上一份）、
// chromium/（Chromium 自己的东西，不用管）。
app.setPath('sessionData', path.join(app.getPath('userData'), 'chromium'));

/**
 * 清掉以前版本留在数据目录顶层的 Chromium 目录。
 *
 * `sessionData` 挪进 `chromium/` 之后，顶层那些同名目录**再也不会被读到** ——
 * 它们是孤儿。留着只会让用户打开数据目录时看到一堆看不懂的东西，
 * 还得从里面翻出 state.json。
 *
 * 只删这份写死的名单，名单里没有 state.json、state.backup.json 和 recovery-*.json。
 * 删不掉也不报错：可能被别的进程占着，而它是孤儿目录，留着不影响正确性。
 */
const ORPHANED_CHROMIUM_ENTRIES = Object.freeze([
  'blob_storage',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'GPUCache',
  'Local Storage',
  'Network',
  'Session Storage',
  'Shared Dictionary',
  'DIPS',
  'Local State',
  'Preferences',
  'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal'
]);

function removeOrphanedChromiumEntries() {
  const dataDirectory = app.getPath('userData');
  for (const name of ORPHANED_CHROMIUM_ENTRIES) {
    try {
      fs.rmSync(path.join(dataDirectory, name), { recursive: true, force: true });
    } catch {
      // 见上：孤儿目录删不掉不影响任何事。
    }
  }
}

removeOrphanedChromiumEntries();

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

/**
 * 把「损坏的原文件保留在哪」如实告诉用户。
 *
 * `addWarning` 自带去重，所以可以在每次保存之后无脑调一次——这样即使坏文件是在
 * 某次 save() 轮转备份时才第一次被发现（而不是启动时），用户也能拿到路径。
 */
function reportPreservedFiles() {
  if (!store) return;
  for (const preservedPath of store.getPreservedCorruptFiles()) {
    addWarning(`损坏的原文件已保留在：${preservedPath}`);
  }
}

function markSaved() {
  hasUnsavedChanges = false;
  currentSaveError = null;
  reportPreservedFiles();
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

/**
 * 首次运行时的初始位置：主屏工作区居中。
 *
 * 没有这一步时窗口由 Windows 自己挑位置 —— 双屏且副屏在左侧时，它有几率被摆到副屏上，
 * 用户第一次启动就找不到自己的清单。保存过位置的老用户不受影响。
 */
function initialWindowBounds({ width, height, x, y }) {
  if (Number.isFinite(x) && Number.isFinite(y)) return { width, height, x, y };
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  };
}

function createAppWindow() {
  const snapshot = engine.getSnapshot();
  windowController = createWindowController({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    htmlPath: path.join(__dirname, 'renderer', 'index.html'),
    bounds: initialWindowBounds(snapshot.windowBounds),
    onBoundsChanged: persistBounds,
    desktopLayer,
    // 吸附只按**主屏**的可用区域算。
    //
    // 试过"跟着窗口所在那块屏"：启动时窗口位置还没稳定，`getDisplayMatching` 会返回
    // 副屏，新装的窗口直接被摆到左屏（实测）。固定主屏是可预期的，代价是多屏用户
    // 不能把清单放在副屏 —— 这条限制写在 docs/design-notes.md 里。
    workArea: () => screen.getPrimaryDisplay().workArea,
    onDesktopAttachment: (outcome) => {
      // 挂不上是正常的降级，不是错误；但「为什么没贴上」必须能从日志回答，
      // 否则这个功能坏掉时是彻底静默的。
      if (!outcome.attached) console.info(`[DoTodo desktop] 没挂到桌面上：${outcome.reason}`);
    },
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

/**
 * 渲染进程点窗口那一下要走的路径。
 *
 * 窗口挂进桌面之后，它的顶层祖先变成了桌面本身，而桌面永远不会被激活 —— 键盘
 * 不会自己落上来，只能由主进程在点击时手动补一次焦点。普通窗口上是空操作。
 */
function createDesktopAdapter() {
  return Object.freeze({
    focus: () => windowController.focusDesktop()
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
 * 把最新快照推给渲染进程。
 *
 * IPC 命令会自己带上快照，但**托盘菜单改的设置不会经过渲染进程**：
 * 用户在托盘里改了设置，设置面板里的选中态就一直是旧的，
 * 直到别的原因触发一次重绘。所以主进程主动推一次。
 */
function broadcastSnapshot() {
  const window = windowController?.getWindow();
  if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return;
  window.webContents.send(SNAPSHOT_CHANNEL, engine.getSnapshot());
}

/**
 * 托盘菜单发出的意图。和 IPC 路径的区别是这里没有渲染进程参与，
 * 所以组合根要自己完成「先让系统生效，再写盘，最后刷新菜单与界面」。
 */
async function handleShellIntent(intent) {
  try {
    if (intent.type === 'launch-at-login') {
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
    // 失败也要推：native 效果可能已经生效、只是没写进配置，界面得反映真实的当前状态。
    broadcastSnapshot();
  }
}

let midnightTimer = null;

/**
 * 到零点就把「今天」翻过去，并推一次快照。
 *
 * 没有这个定时器会怎样：应用整天开着，界面停在昨天。用户点一下昨天那条任务时，
 * 命令进来前会先归档，那条任务已经不在今天了，于是界面弹一条「任务不存在」——
 * 数据没错（归档是准的），但用户每天被莫名报错一次。有了定时器，零点刚过界面就
 * 已经翻页，那一小段窗口期几乎不存在。
 *
 * 定时器 `unref`：它挂着不该阻止进程退出。每次触发后重新算下一次（夏令时当天
 * 不是整 24 小时，所以不能写死 86400000）。
 */
function scheduleMidnightRollover() {
  if (midnightTimer !== null) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    try {
      const prepared = prepareCurrentDay();
      if (prepared && prepared.ok === false) console.error('[DoTodo rollover]', prepared.error);
      else broadcastSnapshot();
    } catch (error) {
      console.error('[DoTodo rollover]', error);
    }
    scheduleMidnightRollover();
  }, millisecondsUntilNextMidnight());
  if (typeof midnightTimer.unref === 'function') midnightTimer.unref();
}

function stopMidnightRollover() {
  if (midnightTimer === null) return;
  clearTimeout(midnightTimer);
  midnightTimer = null;
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
  reportPreservedFiles();
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
    desktop: createDesktopAdapter(),
    prepareState: prepareCurrentDay
  });
  await windowController.load();
  // 界面和数据都就位之后才开始守零点：先挂定时器的话，它可能在窗口还没建好时
  // 触发翻页，虽然不会出错，但会白白推一次没人听的快照。
  scheduleMidnightRollover();
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
    createAppWindow();
    // macOS：关掉窗口应用不退出，再从 Dock 唤起会走到这里。新窗口必须重新绑定
    // 「关闭时隐藏到托盘」，否则那个监听还挂在已经被销毁的旧窗口上。
    shellController?.bindWindow();
    windowController.load().catch((error) => console.error('[DoTodo activate]', error));
  }
});

app.on('second-instance', () => windowController?.show());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopMidnightRollover();
  ipcRegistration?.dispose();
  shellController?.dispose();
  windowController?.dispose();
});
