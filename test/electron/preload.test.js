const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function executePreload() {
  const calls = [];
  const exposed = {};
  const listeners = new Map();
  const ipcRenderer = {
    invoke: (...args) => {
      calls.push(args);
      return Promise.resolve({ ok: true });
    },
    on: (channel, handler) => {
      listeners.set(channel, handler);
    }
  };
  const contextBridge = {
    exposeInMainWorld(name, api) {
      exposed.name = name;
      exposed.api = api;
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8');
  vm.runInNewContext(source, {
    require(identifier) {
      assert.equal(identifier, 'electron');
      return { contextBridge, ipcRenderer };
    },
    Object
  }, { filename: 'preload.js' });
  return { api: exposed.api, calls, exposedName: exposed.name, listeners };
}

test('preload exposes a frozen purpose-specific surface', () => {
  const { api, exposedName } = executePreload();

  assert.equal(exposedName, 'dotodo');
  assert.deepEqual(Object.keys(api).sort(), [
    'addTask',
    'closeWindow',
    'continueTask',
    'deleteHistoryTask',
    'deleteTodayTask',
    'editTask',
    'exportData',
    'getSnapshot',
    'getStatus',
    'importData',
    'minimizeWindow',
    'onSnapshot',
    'openDataFolder',
    'reorderTask',
    'setCloseToTray',
    'setLaunchAtLogin',
    'setWindowMode',
    'toggleTask',
    'undo'
  ]);
  assert.equal(Object.isFrozen(api), true);
  assert.equal('invoke' in api, false);
  assert.equal('send' in api, false);
});

test('preload maps arguments onto fixed IPC channels', async () => {
  const { api, calls } = executePreload();

  await api.getSnapshot();
  await api.getStatus();
  await api.addTask('A');
  await api.editTask('id-1', 'B');
  await api.toggleTask('id-1');
  await api.reorderTask('id-1', 2);
  await api.deleteTodayTask('id-1');
  await api.deleteHistoryTask('2026-09-12', 'id-2');
  await api.continueTask('2026-09-12', 'id-2');
  await api.undo('undo-1');
  await api.setWindowMode('topmost');
  await api.setCloseToTray(true);
  await api.setLaunchAtLogin(false);
  await api.importData();
  await api.exportData();
  await api.openDataFolder();
  await api.minimizeWindow();
  await api.closeWindow();

  assert.deepEqual(calls, [
    ['state:get-snapshot'],
    ['app:get-status'],
    ['task:add', 'A'],
    ['task:edit', 'id-1', 'B'],
    ['task:toggle', 'id-1'],
    ['task:reorder', 'id-1', 2],
    ['task:delete-today', 'id-1'],
    ['history:delete-task', '2026-09-12', 'id-2'],
    ['history:continue-task', '2026-09-12', 'id-2'],
    ['undo:apply', 'undo-1'],
    ['settings:set-window-mode', 'topmost'],
    ['settings:set-close-to-tray', true],
    ['settings:set-launch-at-login', false],
    ['data:import'],
    ['data:export'],
    ['data:open-folder'],
    ['window:minimize'],
    ['window:close']
  ]);
});

test('onSnapshot 只把快照交给回调，不漏出 IpcRendererEvent', () => {
  // 事件对象带着通道内部结构，交到页面手里等于绕开了"窄接口"这条约定。
  const { api, listeners } = executePreload();
  const received = [];

  api.onSnapshot((payload) => received.push(payload));
  assert.equal(listeners.has('state:changed'), true, 'preload 应该在 state:changed 上注册');

  const snapshot = { schemaVersion: 1, activeDay: { date: '2026-09-14', tasks: [] } };
  listeners.get('state:changed')({ sender: 'main-process' }, snapshot);

  assert.deepEqual(received, [snapshot], '回调应该只收到快照本身');
});

test('onSnapshot 收到非函数参数时安静地忽略', () => {
  const { api } = executePreload();
  assert.doesNotThrow(() => api.onSnapshot('not a function'));
  assert.doesNotThrow(() => api.onSnapshot(undefined));
});

test('preload 用到的频道与主进程注册的频道完全一致', async () => {
  // 这是最容易被改坏、又最难发现的一处：改了 ipc.js 里的频道名却漏改 preload.js，
  // 所有单元测试仍然全绿，直到真的点那个按钮才发现"什么都没发生"。
  // 两边各自的清单都是硬编码的（不能自己对着自己校验），这条测试把它们对起来。
  const { CHANNELS } = require('../../src/electron/ipc');
  const { api, calls } = executePreload();

  for (const name of Object.keys(api)) {
    await api[name]('probe-a', 'probe-b');
  }

  const usedByPreload = [...new Set(calls.map(([channel]) => channel))].sort();
  const registered = [...new Set(Object.values(CHANNELS))].sort();

  assert.deepEqual(
    usedByPreload.filter((channel) => !registered.includes(channel)),
    [],
    'preload 调用了主进程没有注册的频道'
  );
  assert.deepEqual(
    registered.filter((channel) => !usedByPreload.includes(channel)),
    [],
    '主进程注册了 preload 永远不会调用的频道'
  );
});
