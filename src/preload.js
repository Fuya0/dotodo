const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotodo', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveTodos: (todos) => ipcRenderer.invoke('state:save-todos', todos),
  setOpacity: (value) => ipcRenderer.invoke('window:set-opacity', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', value),
  setLaunchAtLogin: (value) => ipcRenderer.invoke('app:set-launch-at-login', value),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
