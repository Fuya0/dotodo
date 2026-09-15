const WINDOWS_PLATFORM = 'win32';

/** `GetWindowLongPtrW` / `SetWindowLongPtrW` 的索引：窗口样式（不是扩展样式）。 */
const GWL_STYLE = -16;

/** 目标进程不响应就放弃，别把 Explorer 的卡顿传染给我们自己。 */
const SMTO_ABORTIFHUNG = 0x0002;

const LVM_FIRST = 0x1000;
const LVM_GETITEMCOUNT = LVM_FIRST + 4;
const LVM_GETITEMPOSITION = LVM_FIRST + 16;
const LVM_GETITEMSPACING = LVM_FIRST + 51;

/** `OpenProcess`：读对方的内存，并且要在对方那里分配一块。 */
const PROCESS_VM_READ = 0x0010;
// 少了这个，`VirtualAllocEx` 会以「拒绝访问」(5) 失败 —— 分配内存属于
// PROCESS_VM_OPERATION，不属于 PROCESS_VM_READ。
const PROCESS_VM_OPERATION = 0x0008;
const PROCESS_QUERY_INFORMATION = 0x0400;

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04;

/**
 * 把 koffi 的细节全部关在这个文件里。
 *
 * 桌面层要做的几件事（`SetParent`、`SetFocus`、读桌面图标的格子）Electron 一个都没
 * 暴露，只能自己调 user32 / kernel32。外面拿到的是一个普通对象：句柄统一是
 * `bigint | null`（`null` 就是「没有这个窗口」），布尔就是布尔。
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
    return buildApi(koffi, koffi.load('user32.dll'), koffi.load('kernel32.dll'));
  } catch {
    return null;
  }
}

function buildApi(koffi, user32, kernel32) {
  const HANDLE = 'void *';
  const RECT = koffi.struct('RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
  const POINT = koffi.struct('POINT', { x: 'int', y: 'int' });

  const FindWindowW = user32.func(`${HANDLE} FindWindowW(str16 lpClassName, str16 lpWindowName)`);
  const FindWindowExW = user32.func(
    `${HANDLE} FindWindowExW(${HANDLE} hWndParent, ${HANDLE} hWndChildAfter, str16 lpszClass, str16 lpszWindow)`
  );
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
  const GetWindowRect = user32.func('bool GetWindowRect(void *hWnd, _Out_ RECT *lpRect)');
  const GetWindowThreadProcessId = user32.func(
    'unsigned long GetWindowThreadProcessId(void *hWnd, unsigned long *lpdwProcessId)'
  );
  const SendMessageTimeoutW = user32.func(
    'intptr_t SendMessageTimeoutW(void *hWnd, unsigned int Msg, uintptr_t wParam, intptr_t lParam, ' +
    'unsigned int fuFlags, unsigned int uTimeout, uintptr_t *lpdwResult)'
  );

  const OpenProcess = kernel32.func(
    'void *OpenProcess(unsigned int dwDesiredAccess, bool bInheritHandle, unsigned int dwProcessId)'
  );
  const VirtualAllocEx = kernel32.func(
    'void *VirtualAllocEx(void *hProcess, void *lpAddress, size_t dwSize, unsigned int flAllocationType, unsigned int flProtect)'
  );
  const VirtualFreeEx = kernel32.func(
    'bool VirtualFreeEx(void *hProcess, void *lpAddress, size_t dwSize, unsigned int dwFreeType)'
  );
  const ReadProcessMemory = kernel32.func(
    'bool ReadProcessMemory(void *hProcess, void *lpBaseAddress, void *lpBuffer, size_t nSize, size_t *lpNumberOfBytesRead)'
  );
  const CloseHandle = kernel32.func('bool CloseHandle(void *hObject)');

  /**
   * 发一条窗口消息并把返回值取回来。
   *
   * 一律带 `SMTO_ABORTIFHUNG`：目标是 Explorer 的线程，它要是卡住了，
   * 不带这个标志的等待会把我们自己也拖死。
   */
  function query(hwnd, message) {
    const result = koffi.alloc('uintptr_t', 1);
    try {
      if (!SendMessageTimeoutW(hwnd, message, 0n, 0n, SMTO_ABORTIFHUNG, 1000, result)) return null;
      return koffi.decode(result, 'uintptr_t');
    } finally {
      koffi.free(result);
    }
  }

  function processIdOf(handle) {
    const pid = koffi.alloc('unsigned long', 1);
    try {
      GetWindowThreadProcessId(handle, pid);
      return koffi.decode(pid, 'unsigned long');
    } finally {
      koffi.free(pid);
    }
  }

  return Object.freeze({
    findWindow(className, windowName = null) {
      return handleOrNull(FindWindowW(className, windowName));
    },
    findChildWindow(parent, className) {
      return handleOrNull(FindWindowExW(parent, null, className, null));
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
    getWindowRect(handle) {
      const rect = { left: 0, top: 0, right: 0, bottom: 0 };
      if (!GetWindowRect(handle, rect)) return null;
      return {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top
      };
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
    },

    /** 桌面图标的格子尺寸。`LVM_GETITEMSPACING` 把两个 16 位打包在返回值里。 */
    iconSpacing(listView) {
      const packed = query(listView, LVM_GETITEMSPACING);
      if (packed === null) return null;
      const value = Number(packed);
      const width = value & 0xffff;
      const height = (value >>> 16) & 0xffff;
      return width > 0 && height > 0 ? { width, height } : null;
    },

    iconCount(listView) {
      const count = query(listView, LVM_GETITEMCOUNT);
      return count === null ? null : Number(count);
    },

    /**
     * 读出每个图标的位置。
     *
     * `LVM_GETITEMPOSITION` 要求把结果写进**目标进程**的内存里，所以得先在对方那儿
     * 分配一块、读完再释放。消息号在 `WM_USER`(0x400) 以上，系统不会帮我们搬运指针 ——
     * 这正是必须自己开远程内存的原因。
     *
     * 单个图标读失败就跳过它，不把整次读取废掉：Explorer 随时可能在重排，
     * 读到一半变化是正常的，能读到多少算多少。
     *
     * @returns {Array<{index:number,x:number,y:number}>|null} 完全读不了才是 null。
     */
    iconPositions(listView, count) {
      const pid = processIdOf(listView);
      if (!pid) return null;
      const reader = OpenProcess(
        PROCESS_VM_READ | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION, false, pid
      );
      if (!reader) return null;

      const size = 8; // 一个 POINT：两个 LONG
      const remote = VirtualAllocEx(reader, null, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
      if (!remote) {
        CloseHandle(reader);
        return null;
      }

      const local = koffi.alloc('uint8_t', size);
      const read = koffi.alloc('size_t', 1);
      try {
        const found = [];
        for (let index = 0; index < count; index += 1) {
          const sent = SendMessageTimeoutW(
            listView, LVM_GETITEMPOSITION, BigInt(index), remote, SMTO_ABORTIFHUNG, 1000, null
          );
          if (!sent) continue;
          if (!ReadProcessMemory(reader, remote, local, size, read)) continue;
          const point = koffi.decode(local, POINT);
          found.push({ index, x: point.x, y: point.y });
        }
        return found;
      } finally {
        koffi.free(read);
        koffi.free(local);
        VirtualFreeEx(reader, remote, 0, MEM_RELEASE);
        CloseHandle(reader);
      }
    }
  });
}

/** koffi 用 null 表示空指针，用 BigInt 表示有效句柄；统一成 `bigint | null`。 */
function handleOrNull(value) {
  if (value === null || value === undefined || value === 0 || value === 0n) return null;
  return BigInt(value);
}

module.exports = { loadWin32 };
