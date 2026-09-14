const WINDOWS_PLATFORM = 'win32';

/** `GetWindowLongPtrW` / `SetWindowLongPtrW` 的索引：窗口样式（不是扩展样式）。 */
const GWL_STYLE = -16;

/**
 * 把 koffi 的细节全部关在这个文件里。
 *
 * 桌面层要做的几件事（`SetParent`、`SetFocus`）Electron 一个都没暴露，只能自己
 * 调 user32。外面拿到的是一个普通对象：句柄统一是 `bigint | null`（`null` 就是
 * 「没有这个窗口」），布尔就是布尔。
 *
 * 这层薄壳唯一的价值就是**归一化**。koffi 会把指针返回成 `BigInt`，而窗口句柄从
 * Electron 那边过来是 `Buffer` —— 两种表示混在一起迟早会写成
 * `handle === 0x1013a` 这种永远为假的判断。归一化之后，桌面层的测试可以塞一个
 * 假的调用表进来，不需要真的 Windows。
 *
 * @param {object} [options]
 * @param {string} [options.platform] 用来在测试里假装别的平台。
 * @param {Function} [options.requireModule] 用来在测试里模拟"koffi 装不上"。
 * @returns {object|null} 加载不了就返回 null，调用方据此降级成普通窗口。
 */
function loadWin32({ platform = process.platform, requireModule = require } = {}) {
  if (platform !== WINDOWS_PLATFORM) return null;

  let koffi;
  try {
    koffi = requireModule('koffi');
  } catch {
    // 依赖没装上不该让应用起不来 —— 退回普通窗口就是了。
    return null;
  }
  if (!koffi || typeof koffi.load !== 'function') return null;

  try {
    return buildApi(koffi, koffi.load('user32.dll'));
  } catch {
    return null;
  }
}

function buildApi(koffi, user32) {
  const HANDLE = 'void *';

  const FindWindowW = user32.func(`${HANDLE} FindWindowW(str16 lpClassName, str16 lpWindowName)`);
  const GetParent = user32.func(`${HANDLE} GetParent(${HANDLE} hWnd)`);
  const SetParent = user32.func(`${HANDLE} SetParent(${HANDLE} hWndChild, ${HANDLE} hWndNewParent)`);
  const IsWindow = user32.func('bool IsWindow(void *hWnd)');
  const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)');
  const GetWindowLongPtrW = user32.func('intptr_t GetWindowLongPtrW(void *hWnd, int nIndex)');
  const SetWindowLongPtrW = user32.func('intptr_t SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)');
  const SetWindowPos = user32.func(
    'bool SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)'
  );
  const SetForegroundWindow = user32.func('bool SetForegroundWindow(void *hWnd)');
  const SetFocus = user32.func(`${HANDLE} SetFocus(${HANDLE} hWnd)`);
  const GetFocus = user32.func(`${HANDLE} GetFocus()`);
  const GetForegroundWindow = user32.func(`${HANDLE} GetForegroundWindow()`);

  return Object.freeze({
    findWindow(className, windowName = null) {
      return handleOrNull(FindWindowW(className, windowName));
    },
    getParent(handle) {
      return handleOrNull(GetParent(handle));
    },
    /** @returns {bigint|null} 原来的父窗口；失败时是 null。 */
    setParent(handle, parent) {
      return handleOrNull(SetParent(handle, parent));
    },
    isWindow(handle) {
      return Boolean(IsWindow(handle));
    },
    isWindowVisible(handle) {
      return Boolean(IsWindowVisible(handle));
    },
    getStyle(handle) {
      return Number(GetWindowLongPtrW(handle, GWL_STYLE));
    },
    setStyle(handle, style) {
      return Number(SetWindowLongPtrW(handle, GWL_STYLE, BigInt(style >>> 0)));
    },
    setWindowPos(handle, insertAfter, x, y, width, height, flags) {
      return Boolean(SetWindowPos(handle, insertAfter, x, y, width, height, flags));
    },
    setForegroundWindow(handle) {
      return Boolean(SetForegroundWindow(handle));
    },
    setFocus(handle) {
      SetFocus(handle);
    },
    getFocus() {
      return handleOrNull(GetFocus());
    },
    getForegroundWindow() {
      return handleOrNull(GetForegroundWindow());
    }
  });
}

/** koffi 用 null 表示空指针，用 BigInt 表示有效句柄；统一成 `bigint | null`。 */
function handleOrNull(value) {
  if (value === null || value === undefined || value === 0 || value === 0n) return null;
  return BigInt(value);
}

module.exports = { loadWin32 };
