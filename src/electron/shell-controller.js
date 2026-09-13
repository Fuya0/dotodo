const GLOBAL_ACCELERATOR = 'CommandOrControl+Shift+Space';

/**
 * 窗口层级适配器。
 *
 * `normal` 与 `topmost` 直接映射到 Electron 官方 API。`desktop` 没有等价 API：
 * Windows 上只能用「移出任务栏 + 不置顶」近似，macOS 连等价语义都没有。
 * 与其假装三端一致，这里明确返回一段 `notice`，让界面把差异讲清楚。
 */
function createWindowModeAdapter({ platform = process.platform } = {}) {
  return Object.freeze({
    apply(window, mode) {
      if (mode === 'normal') {
        window.setAlwaysOnTop(false, 'normal');
        window.setSkipTaskbar(false);
        return { applied: 'normal', notice: null };
      }
      if (mode === 'topmost') {
        window.setAlwaysOnTop(true, 'floating');
        window.setSkipTaskbar(false);
        return { applied: 'topmost', notice: null };
      }
      if (mode === 'desktop') {
        window.setAlwaysOnTop(false, 'normal');
        window.setSkipTaskbar(true);
        return {
          applied: 'desktop',
          notice: platform === 'darwin'
            ? 'macOS 没有与 Windows 等价的“钉在桌面”层级：DoTodo 只把窗口移出 Dock 与窗口切换器。'
            : '桌面层级是近似实现：窗口不再出现在任务栏，但也不会固定在其他窗口之下。'
        };
      }
      return null;
    }
  });
}

/**
 * 原生壳层控制器：托盘、全局快捷键、窗口层级、开机启动，以及关闭到托盘。
 *
 * 它只负责「让操作系统发生变化」，不负责持久化。托盘菜单里的设置变更通过
 * `onCommand` 交给组合根，由组合根决定要不要写盘、写失败要不要回滚。
 */
function createShellController(options) {
  const {
    app,
    Tray,
    Menu,
    globalShortcut,
    iconPath,
    getWindow,
    getSettings,
    onCommand = () => {},
    onError = () => {},
    platform = process.platform,
    windowModeAdapter = createWindowModeAdapter({ platform }),
    accelerator = GLOBAL_ACCELERATOR,
    tooltip = 'DoTodo'
  } = options ?? {};

  assertDependencies({ app, Tray, Menu, globalShortcut, iconPath, getWindow, getSettings });

  let tray = null;
  let closeHandler = null;
  let beforeQuitHandler = null;
  let isQuitting = false;
  let disposed = false;

  function initialize() {
    const warnings = [];
    let trayCreated = false;

    if (!disposed) {
      try {
        tray = new Tray(iconPath);
        tray.setToolTip(tooltip);
        refreshMenu();
        if (typeof tray.on === 'function') tray.on('click', toggleVisibility);
        trayCreated = true;
      } catch (error) {
        tray = null;
        warnings.push(`托盘图标创建失败：${describeError(error)}`);
        onError(error);
      }
    }

    attachCloseHandler();
    attachBeforeQuitHandler();

    const shortcut = registerShortcut();
    if (shortcut.warning) warnings.push(shortcut.warning);

    return { ok: true, trayCreated, shortcut, warnings };
  }

  function registerShortcut() {
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, toggleVisibility) !== false;
    } catch (error) {
      onError(error);
      registered = false;
    }
    // register 返回 true 不代表真的拿到：再问一次系统，避免「以为注册上了」。
    if (registered && typeof globalShortcut.isRegistered === 'function' &&
        !globalShortcut.isRegistered(accelerator)) {
      registered = false;
    }
    return {
      accelerator,
      registered,
      warning: registered
        ? null
        : `${accelerator} 已被其他程序占用；可以改用托盘菜单显示窗口。`
    };
  }

  function refreshMenu() {
    if (!tray || typeof Menu?.buildFromTemplate !== 'function') return false;
    const settings = getSettings() ?? {};
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 DoTodo', click: showWindow },
      { label: '隐藏 DoTodo', click: hideWindow },
      { type: 'separator' },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: settings.windowMode === 'topmost',
        click: (item) => runIntent({ type: 'window-mode', mode: item.checked ? 'topmost' : 'normal' })
      },
      {
        label: '关闭时隐藏到托盘',
        type: 'checkbox',
        checked: Boolean(settings.closeToTray),
        click: (item) => runIntent({ type: 'close-to-tray', enabled: Boolean(item.checked) })
      },
      {
        label: '开机启动',
        type: 'checkbox',
        checked: Boolean(settings.launchAtLogin),
        click: (item) => runIntent({ type: 'launch-at-login', enabled: Boolean(item.checked) })
      },
      { type: 'separator' },
      { label: '退出 DoTodo', click: quit }
    ]));
    return true;
  }

  function runIntent(intent) {
    try {
      const result = onCommand(intent);
      if (result && typeof result.catch === 'function') result.catch(onError);
    } catch (error) {
      onError(error);
    }
    return intent;
  }

  function setWindowMode(mode) {
    const window = getWindow();
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
      return { ok: false, error: '窗口还没有创建，无法切换层级。' };
    }
    const outcome = windowModeAdapter.apply(window, mode);
    if (!outcome) return { ok: false, error: `未知窗口模式：${String(mode)}。` };
    return { ok: true, mode: outcome.applied, notice: outcome.notice ?? null };
  }

  function setLaunchAtLogin(enabled) {
    const value = Boolean(enabled);
    try {
      app.setLoginItemSettings({ openAtLogin: value, openAsHidden: false });
    } catch (error) {
      return {
        ok: false,
        effective: readEffectiveLaunchAtLogin(!value),
        error: `无法修改开机启动设置：${describeError(error)}`
      };
    }

    // 写进去不等于生效：未签名或未公证的 macOS 开发包经常被系统静默拒绝。
    const effective = readEffectiveLaunchAtLogin(value);
    if (effective !== value) {
      return {
        ok: false,
        effective,
        error: value
          ? '系统没有接受开机启动设置；未签名或未公证的开发包在 macOS 上通常无法启用。'
          : '系统没有关闭开机启动设置。'
      };
    }
    return { ok: true, effective };
  }

  function readEffectiveLaunchAtLogin(fallback) {
    if (typeof app.getLoginItemSettings !== 'function') return fallback;
    try {
      const settings = app.getLoginItemSettings();
      return typeof settings?.openAtLogin === 'boolean' ? settings.openAtLogin : fallback;
    } catch (error) {
      onError(error);
      return fallback;
    }
  }

  function attachCloseHandler() {
    const window = getWindow();
    if (!window || typeof window.on !== 'function') return;
    closeHandler = (event) => {
      if (isQuitting) return;
      // 托盘是「藏起来之后还能找回来」的唯一入口。连托盘都没建起来时把它藏掉，
      // 用户就再也没法把窗口调出来了——这种情况下宁可让它照常关闭。
      if (!tray) return;
      if (!getSettings()?.closeToTray) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      hideWindow();
    };
    window.on('close', closeHandler);
  }

  function attachBeforeQuitHandler() {
    if (typeof app.on !== 'function') return;
    beforeQuitHandler = () => {
      isQuitting = true;
    };
    app.on('before-quit', beforeQuitHandler);
  }

  function showWindow() {
    const window = getWindow();
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return false;
    window.show();
    if (typeof window.focus === 'function') window.focus();
    return true;
  }

  function hideWindow() {
    const window = getWindow();
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return false;
    window.hide();
    return true;
  }

  function toggleVisibility() {
    const window = getWindow();
    if (!window) return false;
    const visible = typeof window.isVisible === 'function' ? window.isVisible() : true;
    return visible ? hideWindow() : showWindow();
  }

  function quit() {
    isQuitting = true;
    app.quit();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    try {
      globalShortcut.unregister(accelerator);
    } catch (error) {
      onError(error);
    }

    const window = getWindow();
    if (window && typeof window.removeListener === 'function' && closeHandler) {
      window.removeListener('close', closeHandler);
    }
    closeHandler = null;

    if (typeof app.removeListener === 'function' && beforeQuitHandler) {
      app.removeListener('before-quit', beforeQuitHandler);
    }
    beforeQuitHandler = null;

    if (tray) {
      try {
        if (typeof tray.destroy === 'function') tray.destroy();
      } catch (error) {
        onError(error);
      }
      // 托盘对象必须被强引用持有；置空是唯一能让它被回收的方式。
      tray = null;
    }
  }

  return Object.freeze({
    initialize,
    refreshMenu,
    setWindowMode,
    setLaunchAtLogin,
    showWindow,
    hideWindow,
    toggleVisibility,
    quit,
    dispose
  });
}

function assertDependencies({ app, Tray, Menu, globalShortcut, iconPath, getWindow, getSettings }) {
  if (!app || typeof app.setLoginItemSettings !== 'function' || typeof app.quit !== 'function') {
    throw new TypeError('壳层控制器需要 Electron 的 app 对象。');
  }
  if (typeof Tray !== 'function') throw new TypeError('壳层控制器需要 Tray 构造函数。');
  if (!Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new TypeError('壳层控制器需要 Electron 的 Menu 对象。');
  }
  if (!globalShortcut || typeof globalShortcut.register !== 'function' ||
      typeof globalShortcut.unregister !== 'function') {
    throw new TypeError('壳层控制器需要 Electron 的 globalShortcut 对象。');
  }
  if (typeof iconPath !== 'string' || iconPath.length === 0) {
    throw new TypeError('壳层控制器需要托盘图标的绝对路径。');
  }
  if (typeof getWindow !== 'function' || typeof getSettings !== 'function') {
    throw new TypeError('壳层控制器需要窗口与设置的读取函数。');
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { createShellController, createWindowModeAdapter, GLOBAL_ACCELERATOR };
