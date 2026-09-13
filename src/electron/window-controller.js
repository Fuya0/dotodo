function createWindowController({
  BrowserWindow,
  preloadPath,
  htmlPath,
  bounds,
  windowMode = 'normal',
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
    hasShadow: true,
    alwaysOnTop: windowMode === 'topmost',
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
