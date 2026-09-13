function classifyCapability(name) {
  throw new Error('请实现 classifyCapability');
}

function createSafeApi(ipcRenderer) {
  throw new Error('请实现 createSafeApi');
}

function isStrictBoolean(value) {
  throw new Error('请实现 isStrictBoolean');
}

function registerCompactMode(ipcMain, settings) {
  throw new Error('请实现 registerCompactMode');
}

module.exports = {
  classifyCapability,
  createSafeApi,
  isStrictBoolean,
  registerCompactMode
};
