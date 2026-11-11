const GLOBAL_ACCELERATOR = 'CommandOrControl+Shift+Space';

/**
 * 原生壳层控制器：托盘、全局快捷键、开机启动，以及关闭到托盘。
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
    accelerator = GLOBAL_ACCELERATOR,
    tooltip = 'DoTodo'
  } = options ?? {};

  assertDependencies({ app, Tray, Menu, globalShortcut, iconPath, getWindow, getSettings });

  let tray = null;
  let closeHandler = null;
  let closeBoundWindow = null;
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

    bindWindow();
    attachBeforeQuitHandler();

    // 快捷键冲突不写进 warnings：那会让一条非致命的降级占掉界面顶部一整条提示，
    // 甚至盖住标题。注册结果仍然原样返回，由组合根决定写进日志。
    const shortcut = registerShortcut();

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
      { label: '显示在桌面', click: showWindow },
      { label: '从桌面隐藏', click: hideWindow },
      { type: 'separator' },
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

  /**
   * 把「关闭时隐藏到托盘」挂到当前窗口上。
   *
   * **幂等**：先解开上一次的绑定再挂新的。macOS 上用户关掉窗口后应用并不退出，
   * 再从 Dock 唤起会创建一个新窗口——那边必须重新绑定一次，否则新窗口的关闭按钮
   * 会真的把窗口销毁，"关闭到托盘"看起来时灵时不灵。
   */
  function bindWindow() {
    if (closeBoundWindow && closeHandler && typeof closeBoundWindow.removeListener === 'function') {
      closeBoundWindow.removeListener('close', closeHandler);
    }
    closeBoundWindow = null;
    closeHandler = null;

    const window = getWindow();
    if (!window || typeof window.on !== 'function') return false;

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
    closeBoundWindow = window;
    return true;
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
    if (typeof window.isMinimized === 'function' && window.isMinimized() &&
        typeof window.restore === 'function') window.restore();
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

    // 从**绑定时那个**窗口上解绑，而不是当前窗口——重新绑定之后两者可能已经不是同一个。
    if (closeBoundWindow && typeof closeBoundWindow.removeListener === 'function' && closeHandler) {
      closeBoundWindow.removeListener('close', closeHandler);
    }
    closeHandler = null;
    closeBoundWindow = null;

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
    bindWindow,
    refreshMenu,
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

module.exports = { createShellController, GLOBAL_ACCELERATOR };
