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
  setWindowMode: (value) => ipcRenderer.invoke('settings:set-window-mode', value),
  setCloseToTray: (value) => ipcRenderer.invoke('settings:set-close-to-tray', value),
  setLaunchAtLogin: (value) => ipcRenderer.invoke('settings:set-launch-at-login', value),
  importData: () => ipcRenderer.invoke('data:import'),
  exportData: () => ipcRenderer.invoke('data:export'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close')
}));
