const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDesktopLayer, DESKTOP_LAYER_REASONS } = require('../../src/electron/desktop-layer');
const { loadWin32 } = require('../../src/electron/win32');

const PROGMAN = 0x1013an;
const OTHER_WINDOW = 0x2000n;
const WINDOW = 0x111246n;
const POPUP_STYLE = 0x14030000;
const CHILD_STYLE = 0x54030000;

/**
 * 一张假的 Win32 调用表。桌面层的全部逻辑都应该能在它上面跑完 ——
 * 如果哪天有个分支必须真 Windows 才测得了，说明那个分支跑错了地方。
 */
function createFakeNative(overrides = {}) {
  return {
    calls: [],
    host: 'host' in overrides ? overrides.host : PROGMAN,
    parent: 'parent' in overrides ? overrides.parent : null,
    style: 'style' in overrides ? overrides.style : POPUP_STYLE,
    focus: null,
    foreground: null,
    acceptParent: overrides.acceptParent !== false,

    findWindow(className) {
      this.calls.push(['findWindow', className]);
      return this.host;
    },
    isWindow(handle) {
      this.calls.push(['isWindow', handle]);
      return handle !== null;
    },
    getParent(handle) {
      this.calls.push(['getParent', handle]);
      return this.parent;
    },
    setParent(handle, parent) {
      this.calls.push(['setParent', handle, parent]);
      const previous = this.parent;
      if (this.acceptParent) this.parent = parent;
      return previous;
    },
    getStyle(handle) {
      this.calls.push(['getStyle', handle]);
      return this.style;
    },
    setStyle(handle, style) {
      this.calls.push(['setStyle', handle, style]);
      const previous = this.style;
      this.style = style;
      return previous;
    },
    setWindowPos(handle, insertAfter, x, y, width, height, flags) {
      this.calls.push(['setWindowPos', handle, insertAfter, x, y, width, height, flags]);
      return true;
    },
    getWindowRect(handle) {
      this.calls.push(['getWindowRect', handle]);
      // 桌面的屏幕原点故意放在 (-1920, 0)：单屏 (0,0) 时这个差异是 0，测不出来。
      return handle === PROGMAN
        ? { x: -1920, y: 0, width: 3840, height: 1080 }
        : { x: 100, y: 50, width: 380, height: 500 };
    },
    setForegroundWindow(handle) {
      this.calls.push(['setForegroundWindow', handle]);
      if (overrides.foregroundRefused === true) return false;
      this.foreground = handle;
      return true;
    },
    setFocus(handle) {
      this.calls.push(['setFocus', handle]);
      if (overrides.focusRefused !== true) this.focus = handle;
    },
    getFocus() {
      return this.focus;
    },
    getForegroundWindow() {
      return this.foreground;
    }
  };
}

function calledWith(native, name) {
  return native.calls.filter((call) => call[0] === name);
}

test('attach 把窗口挂到桌面，并把它变成真正的子窗口', () => {
  const native = createFakeNative();
  const layer = createDesktopLayer({ native });

  const outcome = layer.attach(WINDOW);

  assert.deepEqual(outcome, { attached: true, reason: DESKTOP_LAYER_REASONS.attached });
  assert.equal(native.parent, PROGMAN);
  // WS_POPUP 去掉、WS_CHILD 加上：不带 WS_CHILD 桌面不会把它当自己的子窗口绘制。
  assert.equal(native.style, CHILD_STYLE);
  assert.deepEqual(calledWith(native, 'setParent'), [['setParent', WINDOW, PROGMAN]]);
});

test('挂载后把窗口摆到 Progman 子窗口的最上面，也就是图标之上', () => {
  const native = createFakeNative();
  createDesktopLayer({ native }).attach(WINDOW);

  const positions = calledWith(native, 'setWindowPos');
  const last = positions.at(-1);
  assert.equal(last[2], null, 'HWND_TOP 用 null 表示');
  // NOMOVE | NOSIZE | NOACTIVATE | SHOWWINDOW：不动位置尺寸，也不抢焦点。
  assert.equal(last.at(-1), 0x0002 | 0x0001 | 0x0010 | 0x0040);
});

test('找不到桌面宿主时，窗口一根手指都不碰', () => {
  const native = createFakeNative({ host: null });
  const outcome = createDesktopLayer({ native }).attach(WINDOW);

  assert.deepEqual(outcome, { attached: false, reason: DESKTOP_LAYER_REASONS.hostMissing });
  assert.equal(calledWith(native, 'setParent').length, 0);
  assert.equal(calledWith(native, 'setStyle').length, 0);
  assert.equal(native.style, POPUP_STYLE);
});

test('SetParent 被系统拒绝时，把窗口样式原样还回去', () => {
  const native = createFakeNative({ acceptParent: false });
  const outcome = createDesktopLayer({ native }).attach(WINDOW);

  assert.deepEqual(outcome, { attached: false, reason: DESKTOP_LAYER_REASONS.parentRefused });
  // 留着一个带 WS_CHILD 的顶级窗口，它会既不被桌面绘制、也不再是普通窗口。
  assert.equal(native.style, POPUP_STYLE);
});

test('已经挂上去的窗口再挂一次是幂等的', () => {
  const native = createFakeNative({ parent: PROGMAN });
  const outcome = createDesktopLayer({ native }).attach(WINDOW);

  assert.deepEqual(outcome, { attached: true, reason: DESKTOP_LAYER_REASONS.alreadyAttached });
  assert.equal(calledWith(native, 'setParent').length, 0);
  assert.equal(native.style, POPUP_STYLE);
});

test('没有句柄时不去查桌面宿主', () => {
  const native = createFakeNative();
  const outcome = createDesktopLayer({ native }).attach(null);

  assert.deepEqual(outcome, { attached: false, reason: DESKTOP_LAYER_REASONS.handleMissing });
  assert.equal(native.calls.length, 0);
});

test('focus 把桌面顶成前台，再把键盘焦点抢到窗口上', () => {
  const native = createFakeNative({ parent: PROGMAN });
  const focused = createDesktopLayer({ native }).focus(WINDOW);

  assert.equal(focused, true);
  assert.equal(native.focus, WINDOW);
  // 桌面本身永远不会被激活，所以键盘是死的 —— 这一步是手动补上的。
  assert.deepEqual(calledWith(native, 'setForegroundWindow'), [['setForegroundWindow', PROGMAN]]);
});

test('普通窗口上 focus 什么都不做：系统自己会给焦点', () => {
  const native = createFakeNative({ parent: null });
  const focused = createDesktopLayer({ native }).focus(WINDOW);

  assert.equal(focused, false);
  assert.equal(calledWith(native, 'setForegroundWindow').length, 0);
  assert.equal(calledWith(native, 'setFocus').length, 0);
});

test('顶不到前台就不硬塞焦点，并如实返回失败', () => {
  const native = createFakeNative({ parent: PROGMAN, foregroundRefused: true });
  const focused = createDesktopLayer({ native }).focus(WINDOW);

  assert.equal(focused, false);
  assert.equal(calledWith(native, 'setFocus').length, 0);
});

test('焦点没落到自己身上也算失败', () => {
  const native = createFakeNative({ parent: PROGMAN, focusRefused: true });
  assert.equal(createDesktopLayer({ native }).focus(WINDOW), false);
});

test('isAttached 如实反映窗口还在不在桌面上', () => {
  assert.equal(createDesktopLayer({ native: createFakeNative({ parent: PROGMAN }) }).isAttached(WINDOW), true);
  assert.equal(createDesktopLayer({ native: createFakeNative({ parent: OTHER_WINDOW }) }).isAttached(WINDOW), false);
  assert.equal(createDesktopLayer({ native: createFakeNative({ parent: PROGMAN, host: null }) }).isAttached(WINDOW), false);
});

test('拿不到原生调用时整层降级，而不是抛错', () => {
  const layer = createDesktopLayer({ native: null });

  assert.equal(layer.isEnabled(), false);
  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => Buffer.alloc(8, 1) }), null);
  assert.equal(layer.focus(WINDOW), false);
  assert.equal(layer.isAttached(WINDOW), false);
  assert.deepEqual(layer.attach(WINDOW), {
    attached: false,
    reason: DESKTOP_LAYER_REASONS.nativeUnavailable
  });
});

test('hwndOf 从 Electron 的 Buffer 里读出句柄', () => {
  const native = createFakeNative();
  const layer = createDesktopLayer({ native });
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(WINDOW);

  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => buffer }), WINDOW);
  assert.equal(layer.isEnabled(), true);
});

test('hwndOf 对拿不到句柄的窗口返回 null', () => {
  const layer = createDesktopLayer({ native: createFakeNative() });

  assert.equal(layer.hwndOf(null), null);
  assert.equal(layer.hwndOf({}), null);
  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => Buffer.alloc(8) }), null, '全零句柄等于没有');
  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => Buffer.alloc(4) }), null, '32 位长度的 Buffer 不是句柄');
  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => 'nope' }), null);
  assert.equal(layer.hwndOf({ getNativeWindowHandle: () => { throw new Error('gone'); } }), null);
});

test('原生调用表缺关键函数时也降级，不半死不活地用', () => {
  const layer = createDesktopLayer({ native: { findWindow: () => PROGMAN } });
  assert.equal(layer.isEnabled(), false);
});

test('loadWin32 在非 Windows 平台上不加载', () => {
  assert.equal(loadWin32({ platform: 'darwin' }), null);
  assert.equal(loadWin32({ platform: 'linux' }), null);
});

test('loadWin32 在 koffi 装不上时返回 null，而不是把应用拖垮', () => {
  const refusing = () => { throw new Error("Cannot find module 'koffi'"); };
  assert.equal(loadWin32({ platform: 'win32', requireModule: refusing }), null);
});

test('loadWin32 在 koffi 加载不了 DLL 时返回 null', () => {
  const brokenKoffi = { load: () => { throw new Error('user32.dll 加载失败'); } };
  assert.equal(loadWin32({ platform: 'win32', requireModule: () => brokenKoffi }), null);
});

test('koffi 在打包时必须被解包，否则打包版会静默退化成普通窗口', () => {
  // koffi 带原生 .node。留在 asar 里它加载不了，而这里的降级又是"安静地当普通
  // 窗口用" —— 开发时一切正常、装完之后功能没了，是最难查的一类问题。
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.ok(manifest.dependencies?.koffi, 'koffi 是运行时依赖，不能只写在 devDependencies 里');
  const unpack = manifest.build?.asarUnpack ?? [];
  assert.ok(
    unpack.some((pattern) => pattern.includes('koffi')),
    `asarUnpack 必须覆盖 koffi，当前是 ${JSON.stringify(unpack)}`
  );
});

test('loadWin32 在本机（Windows）上能真的加载出完整调用表', { skip: process.platform !== 'win32' }, () => {
  const native = loadWin32();
  assert.ok(native, 'Windows 上应该能加载 user32');
  for (const name of [
    'findWindow', 'getParent', 'setParent', 'isWindow', 'isWindowVisible',
    'getStyle', 'setStyle', 'setWindowPos', 'setForegroundWindow',
    'setFocus', 'getFocus', 'getForegroundWindow'
  ]) {
    assert.equal(typeof native[name], 'function', `缺少 ${name}`);
  }
  // 桌面宿主的类名是 Progman；找不到说明这台机器上桌面层根本用不了。
  assert.ok(native.findWindow('Progman', null), '应该能查到 Progman 窗口');
});
