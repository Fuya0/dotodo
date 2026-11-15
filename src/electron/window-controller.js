function createWindowController({
  BrowserWindow,
  preloadPath,
  htmlPath,
  bounds,
  onBoundsChanged,
  desktopLayer = null,
  onDesktopAttachment = () => {},
  sanitizeBounds = (rect) => rect,
  onError = () => {},
  schedule = setTimeout,
  cancelSchedule = clearTimeout
}) {
  if (typeof BrowserWindow !== 'function' || typeof preloadPath !== 'string' ||
      typeof htmlPath !== 'string' || typeof onBoundsChanged !== 'function') {
    throw new TypeError('窗口控制器缺少 BrowserWindow、资源路径或尺寸回调。');
  }

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 330,
    minHeight: 420,
    maxWidth: 720,
    maxHeight: 900,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // hasShadow 会在无边框窗口四周画一圈系统阴影，看起来是"外圈一层灰"。
    // 用户明确要求去掉：它是一个贴在桌面上的平面部件，不该有悬浮投影。
    hasShadow: false,
    // 它是个常驻桌面的小部件，不是要参与窗口管理的应用：
    // 不置顶（不和别的窗口抢位置），也不出现在任务栏里。
    // 以前这里有 normal / topmost / desktop 三种层级可选，删掉了 ——
    // 「层级」本身就是个多余的概念，用户还得先学会它才能选。
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    title: 'DoTodo',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  let boundsTimer = null;
  let boundsRevision = 0;
  let desktopAttachment = null;
  // 用户指定（或上次离开时）的屏幕位置。挂进桌面后 Windows 会把窗口坐标当成
  // 父窗口客户区坐标解释，整体平移一个桌面原点，所以显示之后要按这份目标摆回去。
  let desiredScreenBounds = sanitizeBounds({ ...bounds });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    // 挂到桌面上要在**第一次显示之前**。先以普通窗口的样子闪一下再贴过去，
    // 那一下跳变比什么都显眼；`ready-to-show` 正好是"画好了但还没显示"。
    attachToDesktop();
    window.show();
    // 挂载会把坐标平移一个桌面原点（副屏在主屏左侧时是 -1920），这里摆回来。
    restoreDesiredPosition();
    // 只 show 不够：挂进桌面后顶层祖先是桌面，桌面不会被激活，鼠标点击不会
    // 自动把输入焦点带过来。托盘「显示在桌面」一直有这一步，所以从托盘点开
    // 就能交互，而冷启动看起来"能看见但点不动"。两条路径必须一致。
    activateForInteraction();
  });

  /**
   * 把窗口摆回目标屏幕位置。
   *
   * 不能只算一次坐标就完事：挂进桌面后到底按哪个原点解释坐标，这台机器上出现过
   * 两种相反的结果，一次算错就会把窗口推到屏幕外，而且保存后又会在下次启动继续
   * 往外推。所以这里用闭环：移动 → 重新测量 → 用实测偏差再修正，最多三轮。
   * 只要还能读回矩形，方向猜错也能收敛到目标位置。
   */
  function restoreDesiredPosition() {
    if (!desktopAttachment?.attached || !desktopLayer) return false;
    const hwnd = desktopLayer.hwndOf(window);
    if (!hwnd) return false;
    const origin = typeof desktopLayer.origin === 'function' ? desktopLayer.origin() : null;
    if (!origin) return false;
    if (typeof desktopLayer.moveWindow !== 'function') return false;
    if (typeof desktopLayer.windowRect !== 'function') return false;

    const target = sanitizeBounds(desiredScreenBounds);
    let clientX = target.x - origin.x;
    let clientY = target.y - origin.y;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = desktopLayer.windowRect(hwnd);
      if (before &&
          Math.abs(before.x - target.x) <= 2 && Math.abs(before.y - target.y) <= 2 &&
          before.width === target.width && before.height === target.height) {
        return true;
      }
      desktopLayer.moveWindow(hwnd, {
        x: clientX,
        y: clientY,
        width: target.width,
        height: target.height
      });
      const after = desktopLayer.windowRect(hwnd);
      if (!after) return false;
      const deltaX = target.x - after.x;
      const deltaY = target.y - after.y;
      if (Math.abs(deltaX) <= 2 && Math.abs(deltaY) <= 2) return true;
      // 用实测偏差修正下一次写入的客户区坐标。
      clientX += deltaX;
      clientY += deltaY;
    }
    return false;
  }

  /** 让窗口真正接收输入：桌面层优先补桌面焦点，否则退回普通窗口焦点。 */
  function activateForInteraction() {
    const hwnd = desktopAttachment?.attached && desktopLayer ? desktopLayer.hwndOf(window) : null;
    if (hwnd && typeof desktopLayer.focus === 'function' && desktopLayer.focus(hwnd)) return true;
    window.focus();
    return true;
  }

  /**
   * 让窗口成为桌面的一部分。
   *
   * 挂不上（不是 Windows、没有 koffi、桌面宿主找不到）就照常当普通窗口用 ——
   * 这是加分项，不该让应用起不来，也不该让用户看到任何异常。
   */
  function attachToDesktop() {
    if (!desktopLayer) return;
    desktopAttachment = desktopLayer.attach(desktopLayer.hwndOf(window));
    try {
      onDesktopAttachment(desktopAttachment);
    } catch (error) {
      onError(error);
    }
  }

  function saveBoundsSoon() {
    boundsRevision += 1;
    const revision = boundsRevision;
    if (boundsTimer !== null) cancelSchedule(boundsTimer);
    boundsTimer = schedule(() => {
      if (revision !== boundsRevision || window.isDestroyed()) return;
      boundsTimer = null;
      try {
        const hwnd = desktopAttachment?.attached ? desktopLayer.hwndOf(window) : null;
        const actual = hwnd && typeof desktopLayer.windowRect === 'function'
          ? desktopLayer.windowRect(hwnd)
          : null;
        // 记下用户拖到的新位置，下次启动按它摆回去。落点必须仍然可见，
        // 否则保存一个屏幕外的坐标会让下次启动再也找不到窗口。
        const safe = actual ? sanitizeBounds(actual) : null;
        if (safe) desiredScreenBounds = { ...safe };
        onBoundsChanged(safe || window.getBounds());
      } catch (error) {
        onError(error);
      }
    }, 250);
  }

  window.on('move', saveBoundsSoon);
  window.on('resize', saveBoundsSoon);
  return Object.freeze({
    getWindow: () => window,
    /** 挂载结果，用来回答「为什么没有贴到桌面上」。 */
    getDesktopAttachment: () => desktopAttachment,
    /**
     * 把键盘焦点抢到挂进桌面的窗口上。
     *
     * 窗口一旦挂进桌面，它的顶层祖先就变成了桌面本身，而键盘只发给"顶层窗口处于
     * 激活状态"的那个窗口 —— 桌面永远不会被激活，所以不补这一下，点它的时候
     * 键盘是死的。普通窗口上这是个空操作：系统自己会给焦点。
     */
    focusDesktop() {
      if (!desktopLayer || window.isDestroyed()) return false;
      return desktopLayer.focus(desktopLayer.hwndOf(window));
    },
    load() {
      return Promise.resolve(window.loadFile(htmlPath)).catch((error) => {
        onError(error);
        throw error;
      });
    },
    show() {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      restoreDesiredPosition();
      activateForInteraction();
    },
    hide() {
      if (!window.isDestroyed()) window.hide();
    },
    minimize() {
      if (!window.isDestroyed()) window.minimize();
    },
    close() {
      if (!window.isDestroyed()) window.close();
    },
    dispose() {
      boundsRevision += 1;
      if (boundsTimer !== null) cancelSchedule(boundsTimer);
      boundsTimer = null;
    }
  });
}

module.exports = { createWindowController };
