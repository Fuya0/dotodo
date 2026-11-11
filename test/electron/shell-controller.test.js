const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShellController,
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
    closeToTray: true,
    launchAtLogin: false,
    ...overrides.settings
  };

  /**
   * 每个窗口替身自己持有监听表，并且把每次绑定/解绑都记进 calls。
   * 「关了窗口再从 Dock 唤起」这条 macOS 路径会换一个新窗口，
   * 只有能换窗口才测得出监听有没有跟过去。
   */
  function createWindowFake() {
    const listeners = new Map();
    const fake = {
      listeners,
      visible: true,
      setAlwaysOnTop: (...args) => calls.push(['setAlwaysOnTop', ...args]),
      setSkipTaskbar: (...args) => calls.push(['setSkipTaskbar', ...args]),
      show: () => {
        fake.visible = true;
        calls.push(['show']);
      },
      hide: () => {
        fake.visible = false;
        calls.push(['hide']);
      },
      focus: () => calls.push(['focus']),
      isVisible: () => fake.visible,
      isDestroyed: () => false,
      on: (event, handler) => {
        listeners.set(event, handler);
        calls.push(['window.on', event]);
      },
      removeListener: (event, handler) => {
        calls.push(['window.off', event]);
        if (listeners.get(event) === handler) listeners.delete(event);
      }
    };
    return fake;
  }

  let window = createWindowFake();

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
  });

  return {
    calls,
    settings,
    // `window` 和 `windowListeners` 都取当前窗口：换过窗口之后要看到的是新的那个。
    get window() {
      return window;
    },
    get windowListeners() {
      return window.listeners;
    },
    /** 模拟「窗口被销毁、稍后重建」：getWindow() 从此返回一个全新的替身。 */
    replaceWindow() {
      window = createWindowFake();
      return window;
    },
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

test('快捷键被其他程序占用时静默降级，不占用界面提示位', () => {
  const harness = createHarness();
  harness.globalShortcut.blocked = true;
  const result = harness.controller.initialize();

  assert.equal(result.shortcut.registered, false);
  assert.match(result.shortcut.warning, /占用/);
  // 冲突是非致命降级：注册结果照常返回，但不写进 warnings（那会变成界面顶部的一条提示）。
  assert.deepEqual(result.warnings, []);
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
  const harness = createHarness({ settings: { closeToTray: false, launchAtLogin: true } });
  harness.controller.initialize();

  const labels = harness.menus.at(-1).filter((item) => item.label).map((item) => item.label);
  assert.deepEqual(labels, [
    '显示在桌面',
    '从桌面隐藏',
    '关闭时隐藏到托盘',
    '开机启动',
    '退出 DoTodo'
  ]);
  assert.equal(menuItem(harness, '关闭时隐藏到托盘').checked, false);
  assert.equal(menuItem(harness, '开机启动').checked, true);
});

test('托盘菜单把设置变更交给 onCommand 意图，而不是自己写状态', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '关闭时隐藏到托盘').click({ checked: false });
  menuItem(harness, '开机启动').click({ checked: true });

  assert.deepEqual(harness.intents, [
    { type: 'close-to-tray', enabled: false },
    { type: 'launch-at-login', enabled: true }
  ]);
});

test('托盘菜单的显示与隐藏直接作用在窗口上', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '从桌面隐藏').click();
  assert.equal(harness.window.visible, false);

  menuItem(harness, '显示在桌面').click();
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

  harness.settings.closeToTray = false;
  harness.controller.refreshMenu();

  assert.equal(harness.menus.length, 2);
  assert.equal(menuItem(harness, '关闭时隐藏到托盘').checked, false);
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

test('窗口被重建之后，closeToTray 会重新绑定到新窗口', () => {
  // macOS 上关掉窗口应用并不退出，再从 Dock 唤起会创建一个新窗口。
  // 如果不重新绑定，那个 close 监听还挂在已被销毁的旧窗口上，
  // 表现是「关闭到托盘时灵时不灵」。
  const harness = createHarness();
  harness.controller.initialize();
  const oldWindow = harness.window;
  assert.equal(oldWindow.listeners.has('close'), true);

  const newWindow = harness.replaceWindow();
  assert.equal(newWindow.listeners.has('close'), false, '新窗口一开始不该有任何监听');

  harness.controller.bindWindow();

  assert.equal(newWindow.listeners.has('close'), true, '新窗口应该被重新绑定');
  assert.equal(oldWindow.listeners.has('close'), false, '旧窗口上的监听应该被解开');

  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
  newWindow.listeners.get('close')(event);
  assert.equal(event.prevented, 1, '新窗口的关闭应该被「关闭到托盘」拦下');
  assert.equal(newWindow.visible, false);
});

test('bindWindow 可以重复调用而不会叠加监听', () => {
  const harness = createHarness();
  harness.controller.initialize();
  harness.controller.bindWindow();
  harness.controller.bindWindow();

  const bound = harness.calls.filter(([name]) => name === 'window.on').length;
  const unbound = harness.calls.filter(([name]) => name === 'window.off').length;
  assert.equal(bound - unbound, 1, '同一时刻只应该留着一个 close 监听');
});

test('window 还不存在时 bindWindow 返回 false 而不是抛异常', () => {
  const harness = createHarness({ noWindow: true });
  assert.equal(harness.controller.bindWindow(), false);
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

test('dispose 从当初绑定的那个窗口上解绑', () => {
  // 重新绑定之后，"当前窗口"可能已经不是被绑定的那个了，
  // 所以解绑必须针对当初那个，而不是再问一次 getWindow()。
  const harness = createHarness();
  harness.controller.initialize();
  const boundWindow = harness.window;

  harness.replaceWindow();
  harness.controller.dispose();

  assert.equal(boundWindow.listeners.has('close'), false, '当初绑定的窗口应该被解绑');
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
