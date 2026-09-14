const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotodo', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('state:get-snapshot'),
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  addTask: (text) => ipcRenderer.invoke('task:add', text),
  editTask: (id, text) => ipcRenderer.invoke('task:edit', id, text),
  toggleTask: (id) => ipcRenderer.invoke('task:toggle', id),
  reorderTask: (id, targetIndex) => ipcRenderer.invoke('task:reorder', id, targetIndex),
  deleteTodayTask: (id) => ipcRenderer.invoke('task:delete-today', id),
  deleteHistoryTask: (date, id) => ipcRenderer.invoke('history:delete-task', date, id),
  continueTask: (date, id) => ipcRenderer.invoke('history:continue-task', date, id),
  undo: (token) => ipcRenderer.invoke('undo:apply', token),
  setCloseToTray: (value) => ipcRenderer.invoke('settings:set-close-to-tray', value),
  setLaunchAtLogin: (value) => ipcRenderer.invoke('settings:set-launch-at-login', value),
  importData: () => ipcRenderer.invoke('data:import'),
  exportData: () => ipcRenderer.invoke('data:export'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  /**
   * 订阅主进程主动推来的新快照。
   *
   * 托盘菜单改设置时渲染进程并不知情，只能由主进程推。回调只拿到快照本身，
   * 拿不到 IpcRendererEvent —— 那个对象会漏出通道内部结构。
   */
  onSnapshot: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('state:changed', (_event, snapshot) => handler(snapshot));
  }
}));
