const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function executePreload() {
  const calls = [];
  const exposed = {};
  const ipcRenderer = {
    invoke: (...args) => {
      calls.push(args);
      return Promise.resolve({ ok: true });
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
  return { api: exposed.api, calls, exposedName: exposed.name };
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
    'openDataFolder',
    'reorderTask',
    'setBackgroundOpacity',
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
  await api.setBackgroundOpacity(0.8);
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
    ['settings:set-background-opacity', 0.8],
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
