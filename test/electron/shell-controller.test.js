const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShellController,
  createWindowModeAdapter,
  GLOBAL_ACCELERATOR
} = require('../../src/electron/shell-controller');

function createFakeTrayFactory(calls, { fail = false } = {}) {
  const instances = [];
  class FakeTray {
    constructor(icon) {
      if (fail) throw new Error('tray icon missing');
      this.icon = icon;
      this.destroyed = false;
      instances.push(this);
      calls.push(['new Tray', icon]);
    }

    setToolTip(value) {
      this.toolTip = value;
      calls.push(['setToolTip', value]);
    }

    setContextMenu(menu) {
      this.menu = menu;
      calls.push(['setContextMenu']);
    }

    on(event, handler) {
      this.clickHandler = handler;
      calls.push(['tray.on', event]);
    }

    destroy() {
      this.destroyed = true;
      calls.push(['tray.destroy']);
    }
  }
  return { FakeTray, instances };
}

function createHarness(overrides = {}) {
  const calls = [];
  const settings = {
    backgroundOpacity: 0.82,
    windowMode: 'topmost',
    closeToTray: true,
    launchAtLogin: false,
    ...overrides.settings
  };

  const windowListeners = new Map();
  const window = {
    visible: true,
    setAlwaysOnTop: (...args) => calls.push(['setAlwaysOnTop', ...args]),
    setSkipTaskbar: (...args) => calls.push(['setSkipTaskbar', ...args]),
    show: () => {
      window.visible = true;
      calls.push(['show']);
    },
    hide: () => {
      window.visible = false;
      calls.push(['hide']);
    },
    focus: () => calls.push(['focus']),
    isVisible: () => window.visible,
    isDestroyed: () => false,
    on: (event, handler) => windowListeners.set(event, handler),
    removeListener: (event, handler) => {
      if (windowListeners.get(event) === handler) windowListeners.delete(event);
    }
  };

  const appListeners = new Map();
  const app = {
    loginItem: { openAtLogin: Boolean(settings.launchAtLogin) },
    rejectLoginItem: false,
    hasReadBack: true,
    setLoginItemSettings(next) {
      calls.push(['setLoginItemSettings', next]);
      if (!app.rejectLoginItem) app.loginItem = { openAtLogin: Boolean(next.openAtLogin) };
    },
    getLoginItemSettings: () => ({ ...app.loginItem }),
    quit: () => calls.push(['quit']),
    on: (event, handler) => appListeners.set(event, handler)
  };

  const registered = new Map();
  const globalShortcut = {
    blocked: false,
    register(accelerator, handler) {
      calls.push(['register', accelerator]);
      if (globalShortcut.blocked) return false;
      registered.set(accelerator, handler);
      return true;
    },
    unregister: (accelerator) => {
      calls.push(['unregister', accelerator]);
      registered.delete(accelerator);
    },
    unregisterAll: () => {
      calls.push(['unregisterAll']);
      registered.clear();
    },
    isRegistered: (accelerator) => registered.has(accelerator)
  };

  const trayFactory = createFakeTrayFactory(calls, { fail: Boolean(overrides.failTray) });
  const menus = [];
  const Menu = {
    buildFromTemplate(template) {
      menus.push(template);
      return { template };
    }
  };

  const intents = [];
  const controller = createShellController({
    app,
    Tray: trayFactory.FakeTray,
    Menu,
    globalShortcut,
    platform: overrides.platform || 'win32',
    iconPath: 'C:\\app\\assets\\tray.png',
    getWindow: () => (overrides.noWindow ? null : window),
    getSettings: () => ({ ...settings }),
    onCommand: (intent) => intents.push(intent),
    onError: (error) => calls.push(['onError', error.message]),
    windowModeAdapter: overrides.windowModeAdapter
  });

  return {
    calls,
    settings,
    window,
    windowListeners,
    app,
    appListeners,
    globalShortcut,
    registered,
    menus,
    intents,
    controller,
    trays: trayFactory.instances
  };
}

function menuItem(harness, label) {
  const template = harness.menus.at(-1);
  assert.ok(template, '托盘菜单还没有被创建。');
  const item = template.find((entry) => entry.label === label);
  assert.ok(item, `托盘菜单缺少「${label}」。`);
  return item;
}

test('缺少依赖时立刻抛出 TypeError', () => {
  assert.throws(() => createShellController({}), TypeError);
  assert.throws(
    () => createShellController({ app: {}, Tray: class {}, Menu: {}, globalShortcut: {} }),
    TypeError
  );
});

test('initialize 创建托盘、注册全局快捷键并返回结果', () => {
  const harness = createHarness();
  const result = harness.controller.initialize();

  assert.equal(result.ok, true);
  assert.equal(result.trayCreated, true);
  assert.deepEqual(result.shortcut, { accelerator: GLOBAL_ACCELERATOR, registered: true, warning: null });
  assert.deepEqual(result.warnings, []);

  assert.equal(harness.trays.length, 1);
  assert.equal(harness.trays[0].destroyed, false);
  assert.equal(harness.trays[0].toolTip, 'DoTodo');
  assert.equal(harness.registered.has(GLOBAL_ACCELERATOR), true);
  assert.equal(GLOBAL_ACCELERATOR, 'CommandOrControl+Shift+Space');
});

test('快捷键被其他程序占用时给出可读警告而不是崩溃', () => {
  const harness = createHarness();
  harness.globalShortcut.blocked = true;
  const result = harness.controller.initialize();

  assert.equal(result.shortcut.registered, false);
  assert.match(result.shortcut.warning, /占用/);
  assert.deepEqual(result.warnings, [result.shortcut.warning]);
});

test('托盘创建失败时快捷键仍然可用', () => {
  const harness = createHarness({ failTray: true });
  const result = harness.controller.initialize();

  assert.equal(result.trayCreated, false);
  assert.equal(result.shortcut.registered, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /托盘/);
  assert.equal(harness.trays.length, 0);
});

test('托盘菜单的条目与勾选状态来自当前设置', () => {
  const harness = createHarness({ settings: { windowMode: 'normal', closeToTray: false, launchAtLogin: true } });
  harness.controller.initialize();

  const labels = harness.menus.at(-1).filter((item) => item.label).map((item) => item.label);
  assert.deepEqual(labels, [
    '显示 DoTodo',
    '隐藏 DoTodo',
    '窗口置顶',
    '关闭时隐藏到托盘',
    '开机启动',
    '退出 DoTodo'
  ]);
  assert.equal(menuItem(harness, '窗口置顶').checked, false);
  assert.equal(menuItem(harness, '关闭时隐藏到托盘').checked, false);
  assert.equal(menuItem(harness, '开机启动').checked, true);
});

test('托盘菜单把设置变更交给 onCommand 意图，而不是自己写状态', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '窗口置顶').click({ checked: false });
  menuItem(harness, '关闭时隐藏到托盘').click({ checked: false });
  menuItem(harness, '开机启动').click({ checked: true });

  assert.deepEqual(harness.intents, [
    { type: 'window-mode', mode: 'normal' },
    { type: 'close-to-tray', enabled: false },
    { type: 'launch-at-login', enabled: true }
  ]);
});

test('托盘菜单的显示与隐藏直接作用在窗口上', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '隐藏 DoTodo').click();
  assert.equal(harness.window.visible, false);

  menuItem(harness, '显示 DoTodo').click();
  assert.equal(harness.window.visible, true);
  assert.equal(harness.intents.length, 0);
});

test('托盘菜单的退出条目会真正退出应用', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '退出 DoTodo').click();

  assert.equal(harness.calls.some(([name]) => name === 'quit'), true);
});

test('refreshMenu 按最新设置重建菜单', () => {
  const harness = createHarness();
  harness.controller.initialize();
  assert.equal(harness.menus.length, 1);

  harness.settings.windowMode = 'normal';
  harness.controller.refreshMenu();

  assert.equal(harness.menus.length, 2);
  assert.equal(menuItem(harness, '窗口置顶').checked, false);
});

test('setWindowMode 映射到官方 BrowserWindow API', () => {
  const harness = createHarness();
  harness.controller.initialize();

  assert.deepEqual(harness.controller.setWindowMode('normal'), { ok: true, mode: 'normal', notice: null });
  assert.deepEqual(harness.calls.filter(([name]) => name === 'setAlwaysOnTop'), [['setAlwaysOnTop', false, 'normal']]);
  assert.deepEqual(harness.calls.filter(([name]) => name === 'setSkipTaskbar'), [['setSkipTaskbar', false]]);

  assert.deepEqual(harness.controller.setWindowMode('topmost'), { ok: true, mode: 'topmost', notice: null });
  assert.deepEqual(harness.calls.filter(([name]) => name === 'setAlwaysOnTop'), [
    ['setAlwaysOnTop', false, 'normal'],
    ['setAlwaysOnTop', true, 'floating']
  ]);
});

test('桌面模式返回近似实现的说明，而不是假装与系统等价', () => {
  const windows = createHarness({ platform: 'win32' });
  windows.controller.initialize();
  const windowsResult = windows.controller.setWindowMode('desktop');
  assert.equal(windowsResult.ok, true);
  assert.equal(windowsResult.mode, 'desktop');
  assert.match(windowsResult.notice, /近似/);
  assert.deepEqual(windows.calls.filter(([name]) => name === 'setSkipTaskbar'), [['setSkipTaskbar', true]]);

  const mac = createHarness({ platform: 'darwin' });
  mac.controller.initialize();
  const macResult = mac.controller.setWindowMode('desktop');
  assert.equal(macResult.ok, true);
  assert.match(macResult.notice, /macOS/);
});

test('setWindowMode 拒绝未知模式并且不改动窗口', () => {
  const harness = createHarness();
  harness.controller.initialize();

  const result = harness.controller.setWindowMode('floating-magic');

  assert.equal(result.ok, false);
  assert.match(result.error, /窗口模式/);
  assert.deepEqual(harness.calls.filter(([name]) => name === 'setAlwaysOnTop'), []);
});

test('窗口没有创建时 setWindowMode 返回失败而不是抛异常', () => {
  const harness = createHarness({ noWindow: true });
  harness.controller.initialize();

  const result = harness.controller.setWindowMode('topmost');

  assert.equal(result.ok, false);
  assert.match(result.error, /窗口/);
});

test('窗口模式适配器可以被整体替换', () => {
  const applied = [];
  const harness = createHarness({
    windowModeAdapter: {
      apply: (_window, mode) => {
        applied.push(mode);
        return { applied: mode, notice: '自定义适配器' };
      }
    }
  });
  harness.controller.initialize();

  const result = harness.controller.setWindowMode('desktop');

  assert.deepEqual(applied, ['desktop']);
  assert.equal(result.notice, '自定义适配器');
  assert.deepEqual(harness.calls.filter(([name]) => name === 'setAlwaysOnTop'), []);
});

test('createWindowModeAdapter 对每一种模式都给出确定结果', () => {
  const adapter = createWindowModeAdapter({ platform: 'win32' });
  const recorded = [];
  const fakeWindow = { setAlwaysOnTop: (...a) => recorded.push(a), setSkipTaskbar: (...a) => recorded.push(a) };

  assert.deepEqual(adapter.apply(fakeWindow, 'normal'), { applied: 'normal', notice: null });
  assert.deepEqual(adapter.apply(fakeWindow, 'topmost'), { applied: 'topmost', notice: null });
  assert.equal(adapter.apply(fakeWindow, 'desktop').applied, 'desktop');
  assert.equal(adapter.apply(fakeWindow, 'nope'), null);
  assert.equal(recorded.length, 6);
});

test('setLaunchAtLogin 读回系统状态确认设置真的生效', () => {
  const harness = createHarness();
  harness.controller.initialize();

  assert.deepEqual(harness.controller.setLaunchAtLogin(true), { ok: true, effective: true });
  assert.deepEqual(harness.app.loginItem, { openAtLogin: true });
  assert.deepEqual(harness.controller.setLaunchAtLogin(false), { ok: true, effective: false });
});

test('setLaunchAtLogin 在系统拒绝时报告失败，让调用方不要持久化', () => {
  const harness = createHarness();
  harness.controller.initialize();
  harness.app.rejectLoginItem = true;

  const result = harness.controller.setLaunchAtLogin(true);

  assert.equal(result.ok, false);
  assert.equal(result.effective, false);
  assert.match(result.error, /开机启动/);
});

test('无法读回系统状态时沿用请求值', () => {
  const harness = createHarness();
  harness.controller.initialize();
  delete harness.app.getLoginItemSettings;

  assert.deepEqual(harness.controller.setLaunchAtLogin(true), { ok: true, effective: true });
});

test('setLoginItemSettings 抛异常时返回失败而不是让主进程崩溃', () => {
  const harness = createHarness();
  harness.controller.initialize();
  harness.app.setLoginItemSettings = () => {
    throw new Error('login item unavailable');
  };

  const result = harness.controller.setLaunchAtLogin(true);

  assert.equal(result.ok, false);
  assert.match(result.error, /login item unavailable/);
});

test('关闭窗口时按 closeToTray 隐藏而不是退出', () => {
  const harness = createHarness();
  harness.controller.initialize();
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  harness.windowListeners.get('close')(event);
  assert.equal(event.prevented, 1);
  assert.equal(harness.window.visible, false);

  harness.settings.closeToTray = false;
  harness.windowListeners.get('close')(event);
  assert.equal(event.prevented, 1);
});

test('托盘不可用时关闭窗口不会被拦截，否则窗口会再也找不回来', () => {
  const harness = createHarness({ failTray: true });
  harness.controller.initialize();
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  harness.windowListeners.get('close')(event);

  assert.equal(event.prevented, 0);
});

test('用户主动退出时不再被 closeToTray 拦住', () => {
  const harness = createHarness();
  harness.controller.initialize();
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  harness.controller.quit();
  harness.windowListeners.get('close')(event);

  assert.equal(event.prevented, 0);
  assert.equal(harness.calls.some(([name]) => name === 'quit'), true);
});

test('系统触发的 before-quit 同样绕过 closeToTray', () => {
  const harness = createHarness();
  harness.controller.initialize();
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  harness.appListeners.get('before-quit')();
  harness.windowListeners.get('close')(event);

  assert.equal(event.prevented, 0);
});

test('toggleVisibility 在显示与隐藏之间切换窗口', () => {
  const harness = createHarness();
  harness.controller.initialize();

  harness.controller.toggleVisibility();
  assert.equal(harness.window.visible, false);

  harness.controller.toggleVisibility();
  assert.equal(harness.window.visible, true);
  assert.equal(harness.calls.some(([name]) => name === 'focus'), true);
});

test('全局快捷键真的绑定了 toggleVisibility', () => {
  const harness = createHarness();
  harness.controller.initialize();

  harness.registered.get(GLOBAL_ACCELERATOR)();
  assert.equal(harness.window.visible, false);
});

test('dispose 注销快捷键、销毁托盘并解绑窗口事件', () => {
  const harness = createHarness();
  harness.controller.initialize();
  assert.equal(harness.windowListeners.has('close'), true);

  harness.controller.dispose();

  assert.equal(harness.registered.size, 0);
  assert.equal(harness.trays[0].destroyed, true);
  assert.equal(harness.windowListeners.has('close'), false);
});

test('dispose 可以重复调用而不会重复销毁托盘', () => {
  const harness = createHarness();
  harness.controller.initialize();

  harness.controller.dispose();
  harness.controller.dispose();

  assert.equal(harness.calls.filter(([name]) => name === 'tray.destroy').length, 1);
});

test('没有 initialize 就 dispose 不会抛异常', () => {
  const harness = createHarness();
  assert.doesNotThrow(() => harness.controller.dispose());
});
