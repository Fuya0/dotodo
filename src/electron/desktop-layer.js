const { loadWin32 } = require('./win32');

/** 桌面的窗口类名。Explorer 用它同时承载图标层和壁纸层。 */
const DESKTOP_HOST_CLASS = 'Progman';

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

/**
 * `attach` 为什么是这个结果。全都写在这里，是为了让日志和测试说的是同一套话。
 */
const DESKTOP_LAYER_REASONS = Object.freeze({
  attached: 'attached',
  alreadyAttached: 'already-attached',
  nativeUnavailable: 'native-unavailable',
  handleMissing: 'handle-missing',
  hostMissing: 'desktop-host-missing',
  parentRefused: 'set-parent-refused'
});

/**
 * 桌面层：让窗口成为桌面的一部分，而不是浮在桌面之上的一块窗口。
 *
 * ## 为什么不是普通窗口
 *
 * 普通窗口永远在桌面**之上**：点它会被抬到最前，盖住你正在做的事。挂进桌面层之后
 * 它和桌面图标是兄弟，只会出现在桌面上，永远不会被"点起来"。
 *
 * ## 挂到哪里
 *
 * 网上流传的做法是找**顶层**的 `WorkerW`。那套在这台机器（Windows 11）上找不到
 * 任何东西 —— 这里的结构是：
 *
 *     Progman
 *       +- SHELLDLL_DefView -> SysListView32   图标
 *       +- WorkerW                             壁纸（Progman 的子窗口，不是顶层）
 *
 * 壁纸层还是**临时**的：Win+D、主题变化都会让 Explorer 把它重建一次，挂在它下面的
 * 窗口会跟着被销毁。挂到 `Progman` 本身则和图标层同级、且活得和桌面一样久。
 *
 * ## 键盘
 *
 * 挂进去之后窗口的顶层祖先变成了 `Progman`，而键盘只发给"顶层窗口处于激活状态"
 * 的那个窗口 —— 桌面永远不会被激活，所以点它的时候键盘是死的。`focus()` 手动把
 * 桌面顶成前台再把焦点塞回来。桌面图标能收键盘走的就是同一条路。
 *
 * @param {object} [options]
 * @param {object|null} [options.native] Win32 调用表，默认自己加载；测试塞假的进来。
 */
function createDesktopLayer({ native = loadWin32() } = {}) {
  const usable = isUsable(native);

  return Object.freeze({
    /** 这台机器上能不能做桌面层。不能就老老实实当普通窗口。 */
    isEnabled: () => usable,

    /** 从 Electron 窗口里取出原生句柄。取不到就是 `null`。 */
    hwndOf: (window) => (usable ? readWindowHandle(window) : null),

    attach: (hwnd) => (usable ? attachWindow(native, hwnd) : refused(DESKTOP_LAYER_REASONS.nativeUnavailable)),

    /** 把键盘焦点抢到挂进桌面的窗口上。只有挂上去之后才需要，也只有那时才有用。 */
    focus: (hwnd) => (usable ? focusWindow(native, hwnd) : false),

    /** 窗口现在还挂在桌面上吗。Explorer 重启之后这里会变成 false。 */
    isAttached: (hwnd) => (usable ? isWindowAttached(native, hwnd) : false)
  });
}

function isUsable(native) {
  return Boolean(native) && typeof native.findWindow === 'function' && typeof native.setParent === 'function';
}

function attachWindow(native, hwnd) {
  if (!hwnd) return refused(DESKTOP_LAYER_REASONS.handleMissing);

  const host = native.findWindow(DESKTOP_HOST_CLASS, null);
  if (!host || !native.isWindow(host)) return refused(DESKTOP_LAYER_REASONS.hostMissing);
  if (native.getParent(hwnd) === host) return { attached: true, reason: DESKTOP_LAYER_REASONS.alreadyAttached };

  // 不带上 WS_CHILD 的话，桌面不会把它当成自己的子窗口来绘制。
  const style = native.getStyle(hwnd);
  native.setStyle(hwnd, (style & ~WS_POPUP) | WS_CHILD);
  native.setParent(hwnd, host);

  if (native.getParent(hwnd) !== host) {
    // 没挂上就把样式还回去。留着一个带着 WS_CHILD 的顶级窗口，它会既不被桌面绘制、
    // 也不再算普通窗口 —— 比不挂还糟。
    native.setStyle(hwnd, style);
    return refused(DESKTOP_LAYER_REASONS.parentRefused);
  }

  // `null` 就是 HWND_TOP：和图标层同级，但画在图标上面。
  native.setWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  return { attached: true, reason: DESKTOP_LAYER_REASONS.attached };
}

function focusWindow(native, hwnd) {
  if (!hwnd) return false;

  // 父窗口不是桌面，说明它还是个普通窗口：点一下系统自己会给焦点，不用我们插手。
  const host = native.getParent(hwnd);
  if (!host) return false;

  if (!native.setForegroundWindow(host)) return false;
  native.setFocus(hwnd);
  return native.getFocus() === hwnd;
}

function isWindowAttached(native, hwnd) {
  if (!hwnd) return false;
  const host = native.findWindow(DESKTOP_HOST_CLASS, null);
  return Boolean(host) && native.getParent(hwnd) === host;
}

function refused(reason) {
  return { attached: false, reason };
}

/**
 * Electron 给的句柄是一个装着指针的 `Buffer`。64 位进程里它是 8 字节，
 * 读成 `BigInt` 才和 koffi 返回的句柄是同一个类型。
 */
function readWindowHandle(window) {
  if (!window || typeof window.getNativeWindowHandle !== 'function') return null;
  let raw;
  try {
    raw = window.getNativeWindowHandle();
  } catch {
    return null;
  }
  if (!Buffer.isBuffer(raw) || raw.length < 8) return null;
  const value = raw.readBigUInt64LE(0);
  return value === 0n ? null : value;
}

module.exports = { createDesktopLayer, DESKTOP_LAYER_REASONS };
