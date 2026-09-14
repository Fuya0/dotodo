function createWindowController({
  BrowserWindow,
  preloadPath,
  htmlPath,
  bounds,
  onBoundsChanged,
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  function saveBoundsSoon() {
    boundsRevision += 1;
    const revision = boundsRevision;
    if (boundsTimer !== null) cancelSchedule(boundsTimer);
    boundsTimer = schedule(() => {
      if (revision !== boundsRevision || window.isDestroyed()) return;
      boundsTimer = null;
      try {
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
