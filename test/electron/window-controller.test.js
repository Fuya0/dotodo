const test = require('node:test');
const assert = require('node:assert/strict');

let windowModule = {};
try {
  windowModule = require('../../src/electron/window-controller');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const WINDOW_HANDLE = 0x111246n;

class FakeWebContents {
  constructor() {
    this.listeners = new Map();
    this.openHandler = null;
  }

  on(event, handler) {
    this.listeners.set(event, handler);
  }

  setWindowOpenHandler(handler) {
    this.openHandler = handler;
  }
}

class FakeBrowserWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    this.listeners = new Map();
    this.onceListeners = new Map();
    this.loadedFile = null;
    this.visible = false;
    this.minimized = false;
    this.closed = false;
    this.destroyed = false;
    this.bounds = { x: 40, y: 50, width: 390, height: 610 };
    FakeBrowserWindow.instances.push(this);
  }

  loadFile(filePath) { this.loadedFile = filePath; return Promise.resolve(); }
  on(event, handler) { this.listeners.set(event, handler); }
  once(event, handler) { this.onceListeners.set(event, handler); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() { this.focused = true; }
  minimize() { this.minimized = true; }
  restore() { this.minimized = false; }
  isMinimized() { return this.minimized; }
  close() { this.closed = true; }
  isDestroyed() { return this.destroyed; }
  getBounds() { return { ...this.bounds }; }
}

function createFakeDesktopLayer(outcome = { attached: true, reason: 'attached' }) {
  const calls = [];
  return {
    calls,
    hwndOf(window) { calls.push(['hwndOf', window]); return WINDOW_HANDLE; },
    attach(handle) { calls.push(['attach', handle]); return outcome; },
    focus(handle) { calls.push(['focus', handle]); return true; }
  };
}

function createHarness(options = {}) {
  FakeBrowserWindow.instances = [];
  const scheduled = [];
  const boundsChanges = [];
  const errors = [];
  const controller = windowModule.createWindowController({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: 'C:\\app\\preload.js',
    htmlPath: 'C:\\app\\renderer\\index.html',
    bounds: { x: 10, y: 20, width: 410, height: 620 },
    onBoundsChanged: (bounds) => boundsChanges.push(bounds),
    onError: (error) => errors.push(error),
    desktopLayer: options.desktopLayer ?? null,
    schedule: (callback) => (scheduled.push(callback), scheduled.length),
    cancelSchedule: () => {}
  });
  return { boundsChanges, controller, errors, scheduled, window: FakeBrowserWindow.instances[0] };
}

test('createWindowController hardens the window and waits for explicit load', async () => {
  assert.equal(typeof windowModule.createWindowController, 'function');
  const { controller, window } = createHarness();

  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.equal(window.options.frame, false);
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.backgroundColor, '#00000000');
  assert.equal(window.options.show, false);
  assert.equal(window.options.minWidth, 330);
  assert.equal(window.options.minHeight, 420);
  assert.equal(window.options.maxWidth, 720);
  assert.equal(window.options.maxHeight, 900);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.preload, 'C:\\app\\preload.js');
  assert.equal('opacity' in window.options, false);
  assert.equal(window.loadedFile, null);
  await controller.load();
  assert.equal(window.loadedFile, 'C:\\app\\renderer\\index.html');
});

test('the window denies renderer navigation and new windows', () => {
  const { window } = createHarness();
  const navigationEvent = { prevented: false, preventDefault() { this.prevented = true; } };

  window.webContents.listeners.get('will-navigate')(navigationEvent, 'https://example.com');

  assert.equal(navigationEvent.prevented, true);
  assert.deepEqual(window.webContents.openHandler({ url: 'https://example.com' }), { action: 'deny' });
});

test('ready, visibility and window commands stay inside the controller', () => {
  const { controller, window } = createHarness();

  window.onceListeners.get('ready-to-show')();
  assert.equal(window.visible, true);
  controller.minimize();
  assert.equal(window.minimized, true);
  controller.show();
  assert.equal(window.minimized, false);
  assert.equal(window.focused, true);
  controller.close();
  assert.equal(window.closed, true);
});

test('move and resize persist one validated bounds snapshot after debounce', () => {
  const { boundsChanges, scheduled, window } = createHarness();

  window.listeners.get('move')();
  window.listeners.get('resize')();
  assert.equal(scheduled.length, 2);
  scheduled.at(-1)();

  assert.deepEqual(boundsChanges, [{ x: 40, y: 50, width: 390, height: 610 }]);
});

test('bounds persistence errors are reported without crashing the window callback', () => {
  FakeBrowserWindow.instances = [];
  const scheduled = [];
  const errors = [];
  const windowController = windowModule.createWindowController({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: 'preload.js',
    htmlPath: 'index.html',
    bounds: { width: 390, height: 610 },
    onBoundsChanged: () => { throw new Error('disk full'); },
    onError: (error) => errors.push(error),
    schedule: (callback) => (scheduled.push(callback), scheduled.length),
    cancelSchedule: () => {}
  });

  windowController.getWindow().listeners.get('resize')();
  assert.doesNotThrow(() => scheduled[0]());
  assert.match(errors[0].message, /disk full/);
});

test('窗口在第一次显示之前就挂进桌面层', () => {
  const desktopLayer = createFakeDesktopLayer();
  const { controller, window } = createHarness({ desktopLayer });

  // 建好就挂的话，用户会先看到一个普通窗口闪一下再贴到桌面上。
  assert.equal(desktopLayer.calls.length, 0);
  assert.equal(window.visible, false);

  window.onceListeners.get('ready-to-show')();

  assert.equal(desktopLayer.calls[0][0], 'hwndOf');
  assert.equal(desktopLayer.calls[0][1], window);
  assert.deepEqual(desktopLayer.calls[1], ['attach', WINDOW_HANDLE]);
  assert.equal(window.visible, true, '挂载不能挡住显示');
  assert.deepEqual(controller.getDesktopAttachment(), { attached: true, reason: 'attached' });
});

test('挂载失败时照常显示，并把原因留着', () => {
  const desktopLayer = createFakeDesktopLayer({ attached: false, reason: 'desktop-host-missing' });
  const { controller, window } = createHarness({ desktopLayer });

  window.onceListeners.get('ready-to-show')();

  assert.equal(window.visible, true);
  assert.deepEqual(controller.getDesktopAttachment(), { attached: false, reason: 'desktop-host-missing' });
});

test('窗口已经销毁就不再挂载', () => {
  const desktopLayer = createFakeDesktopLayer();
  const { window } = createHarness({ desktopLayer });
  window.destroyed = true;

  window.onceListeners.get('ready-to-show')();

  assert.equal(desktopLayer.calls.length, 0);
});

test('没有桌面层时窗口照常显示，focusDesktop 是空操作', () => {
  const { controller, window } = createHarness();

  window.onceListeners.get('ready-to-show')();

  assert.equal(window.visible, true);
  assert.equal(controller.getDesktopAttachment(), null);
  assert.equal(controller.focusDesktop(), false);
});

test('focusDesktop 把窗口句柄交给桌面层', () => {
  const desktopLayer = createFakeDesktopLayer();
  const { controller } = createHarness({ desktopLayer });

  assert.equal(controller.focusDesktop(), true);
  assert.deepEqual(desktopLayer.calls, [['hwndOf', FakeBrowserWindow.instances[0]], ['focus', WINDOW_HANDLE]]);
});

test('窗口销毁后 focusDesktop 不再碰原生调用', () => {
  const desktopLayer = createFakeDesktopLayer();
  const { controller, window } = createHarness({ desktopLayer });
  window.destroyed = true;

  assert.equal(controller.focusDesktop(), false);
  assert.equal(desktopLayer.calls.length, 0);
});
