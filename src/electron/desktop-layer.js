const { loadWin32 } = require('./win32');
const { gridOrigin } = require('./icon-grid');

/** 桌面的窗口类名。Explorer 用它同时承载图标层和壁纸层。 */
const DESKTOP_HOST_CLASS = 'Progman';

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
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
 * ## 坐标系（踩过两次的地方）
 *
 * 窗口挂进桌面后是 WS_CHILD，于是同一个矩形有两种说法：
 *
 *   - `GetWindowRect` / Electron 的 `getBounds` → **屏幕**坐标
 *   - `SetWindowPos` / Electron 的 `setBounds` → **父窗口客户区**坐标
 *
 * 桌面从 (0,0) 开始时两者相等，单屏机器上这个差别永远看不出来。副屏放在主屏左边时，
 * 桌面窗口的屏幕原点是 (-1920, 0)，两种坐标差整整一块屏 —— 拿一套坐标去喂另一套，
 * 窗口就会被扔到另一块屏、甚至屏幕外。
 *
 * 所以这里的约定是：
 *
 *   - `iconLayout()` 返回的图标坐标保持 `LVM_GETITEMPOSITION` 原样（= 桌面客户区坐标）
 *   - `origin()` 给出桌面窗口的屏幕原点
 *   - 调用方把 `getBounds()`（屏幕）减去 `origin()` 得到客户区坐标后再规划，
 *     最后把客户区坐标交给 `setBounds`
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
    isAttached: (hwnd) => (usable ? isWindowAttached(native, hwnd) : false),

    /**
     * 桌面图标的格子尺寸、网格原点和每个图标的位置，全部是**桌面客户区坐标**。
     *
     * 图标的位置在 Explorer 进程的内存里，要跨进程读 —— 哪一步读不到都返回 null，
     * 调用方据此什么都不做。桌面层的任何一步失败都不该影响窗口正常显示。
     */
    iconLayout: () => (usable ? readIconLayout(native) : null),

    /** 桌面窗口在屏幕上的原点；配合 `getBounds` 换算出客户区坐标。 */
    origin: () => (usable ? desktopOrigin(native) : null),

    /**
     * 窗口当前的矩形（**屏幕坐标**）。
     *
     * 不用 `BrowserWindow.getBounds()`：挂进桌面之后它返回的是 Chromium 记的那一份，
     * 每边比实际窗口窄 8px（实测：实际 20,257 / 380x595，它报 28,257 / 364x587）。
     * 差这 8px 会让"是否已经对齐"的判断反复失效，位置来回抖。
     */
    windowRect: (hwnd) => (usable ? native.getWindowRect(hwnd) : null),

    /**
     * 把窗口摆到 `rect`（**客户区坐标**，和 `iconLayout` 的图标坐标同一个空间）。
     *
     * 只能用原生 `SetWindowPos`：挂进桌面之后 `BrowserWindow.setBounds` 是空操作
     * （实测调用后位置纹丝不动），而原生这条路有效，且不会被 Chromium 拽回去。
     */
    moveWindow: (hwnd, rect) => {
      if (!usable || !hwnd || !rect) return false;
      return native.setWindowPos(
        hwnd, null, rect.x, rect.y, rect.width, rect.height,
        0x0004 | 0x0010 | 0x0040
      );
    }
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
  // 挂之前先记住屏幕位置：加上 WS_CHILD 并 SetParent 之后，Windows 会把窗口现有的
  // 坐标**当成父窗口客户区坐标**重新解释，于是整体平移一个桌面原点的距离。
  const beforeAttach = native.getWindowRect(hwnd);

  native.setStyle(hwnd, (style & ~WS_POPUP) | WS_CHILD);
  native.setParent(hwnd, host);

  if (native.getParent(hwnd) !== host) {
    // 没挂上就把样式还回去。留着一个带着 WS_CHILD 的顶级窗口，它会既不被桌面绘制、
    // 也不再算普通窗口 —— 比不挂还糟。
    native.setStyle(hwnd, style);
    return refused(DESKTOP_LAYER_REASONS.parentRefused);
  }

  // 挪回原来的屏幕位置：屏幕坐标减桌面原点 = 客户区坐标。
  const hostRect = native.getWindowRect(host);
  if (beforeAttach && hostRect) {
    native.setWindowPos(
      hwnd, null,
      beforeAttach.x - hostRect.x, beforeAttach.y - hostRect.y,
      beforeAttach.width, beforeAttach.height,
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
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

/**
 * 读出桌面图标的格子尺寸、网格原点和每个图标的位置（桌面客户区坐标）。
 *
 * 链路是 Explorer 自己的窗口树：`Progman -> SHELLDLL_DefView -> SysListView32`。
 * 任何一环缺失都返回 null —— 拿不到就不摆，而不是猜一个位置。
 */
function readIconLayout(native) {
  if (typeof native.findChildWindow !== 'function' || typeof native.iconSpacing !== 'function' ||
      typeof native.iconCount !== 'function' || typeof native.iconPositions !== 'function') {
    return null;
  }

  const host = native.findWindow(DESKTOP_HOST_CLASS, null);
  if (!host) return null;
  const defView = native.findChildWindow(host, 'SHELLDLL_DefView');
  if (!defView) return null;
  const listView = native.findChildWindow(defView, 'SysListView32');
  if (!listView) return null;

  const cell = native.iconSpacing(listView);
  if (!cell) return null;
  const count = native.iconCount(listView);
  if (count === null) return null;
  const positions = native.iconPositions(listView, count);
  if (!positions) return null;

  return { cell, origin: gridOrigin(positions, cell), positions };
}

/** 桌面窗口在屏幕上的原点。 */
function desktopOrigin(native) {
  if (typeof native.getWindowRect !== 'function') return null;
  const host = native.findWindow(DESKTOP_HOST_CLASS, null);
  if (!host) return null;
  const rect = native.getWindowRect(host);
  return rect ? { x: rect.x, y: rect.y } : null;
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
