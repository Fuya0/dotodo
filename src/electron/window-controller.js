const { planBounds } = require('./icon-grid');

function createWindowController({
  BrowserWindow,
  preloadPath,
  htmlPath,
  bounds,
  onBoundsChanged,
  desktopLayer = null,
  onDesktopAttachment = () => {},
  workArea = () => null,
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    // 挂到桌面上要在**第一次显示之前**。先以普通窗口的样子闪一下再贴过去，
    // 那一下跳变比什么都显眼；`ready-to-show` 正好是"画好了但还没显示"。
    attachToDesktop();
    // 摆位也要在显示之前，否则用户会看到它先落在旧位置再跳一下。
    applyDesktopGrid();
    window.show();
  });

  /**
   * 把窗口摆到桌面图标的网格上，并且不压住任何图标。
   *
   * 读不到图标布局（不是 Windows、Explorer 不给读、桌面层没挂上）就什么都不做 ——
   * 这条路径上的任何失败都只该表现为"窗口待在原地"，不该有别的后果。
   */
  function applyDesktopGrid() {
    if (!desktopLayer || window.isDestroyed()) return;
    const layout = desktopLayer.iconLayout();
    const area = workArea();
    const origin = desktopLayer.origin ? desktopLayer.origin() : null;
    if (!layout || !area || !origin) return;

    // 坐标系：图标位置是**桌面客户区**坐标，而 getBounds 给的是**屏幕**坐标。
    // 把窗口位置和可用区域都减去桌面原点，统一到客户区坐标系再规划、再写回。
    // 直接混用两套坐标时，副屏放在主屏左边的机器上窗口会被扔到屏幕外。
    const bounds = window.getBounds();
    const clientBounds = {
      x: bounds.x - origin.x,
      y: bounds.y - origin.y,
      width: bounds.width,
      height: bounds.height
    };
    const clientArea = {
      x: area.x - origin.x,
      y: area.y - origin.y,
      width: area.width,
      height: area.height
    };

    const target = planBounds({
      bounds: clientBounds,
      cell: layout.cell,
      origin: layout.origin,
      positions: layout.positions,
      screen: clientArea
    });
    if (!target) return;

    // 相等就停。setBounds 会再发一次 move/resize，靠这一句让来回吸附收敛。
    if (clientBounds.x === target.x && clientBounds.y === target.y &&
        clientBounds.width === target.width && clientBounds.height === target.height) {
      return;
    }

    // 交给 Electron 写：它和 Chromium 的窗口缓存是一套的，我们在外面直接 SetWindowPos
    // 会被它按缓存拽回去。它按父窗口客户区坐标写，正好就是这里算出来的坐标系。
    window.setBounds(target);
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
        // 拖完/缩完之后先吸附回网格，再记位置 —— 记下来的就是最终那一份。
        applyDesktopGrid();
        onBoundsChanged(window.getBounds());
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
      window.focus();
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
