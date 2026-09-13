const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCapability,
  createSafeApi,
  isStrictBoolean,
  registerCompactMode
} = require('./starter');

test('classifyCapability assigns work to the least privileged process', () => {
  assert.equal(classifyCapability('createBrowserWindow'), 'main');
  assert.equal(classifyCapability('readStateFile'), 'main');
  assert.equal(classifyCapability('exposeTodoApi'), 'preload');
  assert.equal(classifyCapability('renderTaskList'), 'renderer');
  assert.equal(classifyCapability('listenForClick'), 'renderer');
  assert.equal(classifyCapability('mystery'), 'unknown');
});

test('createSafeApi fixes channel names and hides raw IPC', async () => {
  const calls = [];
  const ipcRenderer = {
    invoke: (...args) => (calls.push(args), Promise.resolve('ok'))
  };
  const api = createSafeApi(ipcRenderer);

  await api.getVersion();
  await api.setCompactMode(true);

  assert.deepEqual(calls, [
    ['app:get-version'],
    ['settings:set-compact-mode', true]
  ]);
  assert.deepEqual(Object.keys(api).sort(), ['getVersion', 'setCompactMode']);
  assert.equal(Object.isFrozen(api), true);
});

test('isStrictBoolean does not coerce strings or numbers', () => {
  assert.equal(isStrictBoolean(true), true);
  assert.equal(isStrictBoolean(false), true);
  assert.equal(isStrictBoolean('false'), false);
  assert.equal(isStrictBoolean(0), false);
  assert.equal(isStrictBoolean(null), false);
});

test('registerCompactMode validates input and can dispose its handler', async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel)
  };
  const settings = {
    setCompactMode: (value) => calls.push(value)
  };
  const registration = registerCompactMode(ipcMain, settings);
  const handler = handlers.get('settings:set-compact-mode');

  assert.deepEqual(await handler({}, 'true'), { ok: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(await handler({}, true), { ok: true, value: true });
  assert.deepEqual(calls, [true]);

  registration.dispose();
  assert.equal(handlers.size, 0);
});
