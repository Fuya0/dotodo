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

test('托盘菜单只保留开机启动与退出', () => {
  const harness = createHarness({ settings: { launchAtLogin: true } });
  harness.controller.initialize();

  const labels = harness.menus.at(-1).filter((item) => item.label).map((item) => item.label);
  assert.deepEqual(labels, ['开机启动', '退出 DoTodo']);
  assert.equal(menuItem(harness, '开机启动').checked, true);
});

test('托盘菜单把开机启动交给 onCommand 意图，而不是自己写状态', () => {
  const harness = createHarness();
  harness.controller.initialize();

  menuItem(harness, '开机启动').click({ checked: true });

  assert.deepEqual(harness.intents, [{ type: 'launch-at-login', enabled: true }]);
});

test('托盘左键切换显示时会先恢复最小化窗口', () => {
  const harness = createHarness();
  let minimized = true;
  harness.window.isMinimized = () => minimized;
  harness.window.restore = () => { minimized = false; };
  harness.window.visible = false;
  harness.controller.initialize();
  harness.trays.at(-1).clickHandler();
  assert.equal(minimized, false);
  assert.equal(harness.window.visible, true);
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

  harness.settings.launchAtLogin = true;
  harness.controller.refreshMenu();

  assert.equal(harness.menus.length, 2);
  assert.equal(menuItem(harness, '开机启动').checked, true);
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

test('关闭窗口不再被拦截，直接走系统默认的退出', () => {
  const harness = createHarness();
  harness.controller.initialize();

  assert.equal(harness.windowListeners.has('close'), false, '不该再注册 close 拦截');
});

test('窗口被重建之后也不会注册 close 拦截', () => {
  const harness = createHarness();
  harness.controller.initialize();
  const newWindow = harness.replaceWindow();
  harness.controller.bindWindow();
  assert.equal(newWindow.listeners.has('close'), false);
});

test('bindWindow 重复调用不会抛异常', () => {
  const harness = createHarness();
  harness.controller.initialize();
  assert.equal(harness.controller.bindWindow(), true);
  assert.equal(harness.controller.bindWindow(), true);
});

test('window 还不存在时 bindWindow 也返回 true', () => {
  const harness = createHarness({ noWindow: true });
  assert.equal(harness.controller.bindWindow(), true);
});

test('quit 仍然会真正退出应用', () => {
  const harness = createHarness();
  harness.controller.initialize();
  harness.controller.quit();
  assert.equal(harness.calls.some(([name]) => name === 'quit'), true);
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
  harness.controller.dispose();

  assert.equal(harness.registered.size, 0);
  assert.equal(harness.trays[0].destroyed, true);
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


