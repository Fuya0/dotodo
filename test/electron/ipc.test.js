const test = require('node:test');
const assert = require('node:assert/strict');

let ipcModule = {};
try {
  ipcModule = require('../../src/electron/ipc');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const EXPECTED_CHANNELS = [
  'app:get-status',
  'data:export',
  'data:import',
  'data:open-folder',
  'history:continue-task',
  'history:delete-task',
  'settings:set-close-to-tray',
  'settings:set-launch-at-login',
  'state:get-snapshot',
  'task:add',
  'task:delete-today',
  'task:edit',
  'task:reorder',
  'task:toggle',
  'undo:apply',
  'window:close',
  'window:minimize',
  'window:request-desktop-focus'
];

function createRecordingIpcMain() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate channel: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    }
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const snapshot = { schemaVersion: 1, marker: 'current' };
  const commandResult = { ok: true, snapshot: { schemaVersion: 1, marker: 'next' } };
  const engine = {
    getSnapshot: () => snapshot,
    addTask: (...args) => (calls.push(['addTask', ...args]), commandResult),
    editTask: (...args) => (calls.push(['editTask', ...args]), commandResult),
    toggleTask: (...args) => (calls.push(['toggleTask', ...args]), commandResult),
    reorderTask: (...args) => (calls.push(['reorderTask', ...args]), commandResult),
    deleteTodayTask: (...args) => (calls.push(['deleteTodayTask', ...args]), commandResult),
    deleteHistoryTask: (...args) => (calls.push(['deleteHistoryTask', ...args]), commandResult),
    undo: (...args) => (calls.push(['undo', ...args]), commandResult),
    continueTask: (...args) => (calls.push(['continueTask', ...args]), commandResult),
    updateSettings: (...args) => (calls.push(['updateSettings', ...args]), commandResult),
    replaceState: (...args) => (calls.push(['replaceState', ...args]), commandResult)
  };
  const store = {
    save: (state) => calls.push(['save', state]),
    importFrom: (filePath) => (calls.push(['importFrom', filePath]), { schemaVersion: 1, marker: 'imported' }),
    exportTo: (filePath, state) => calls.push(['exportTo', filePath, state]),
    getPaths: () => ({ primary: 'C:\\data\\state.json' })
  };
  const dialogs = {
    chooseImportPath: async () => 'C:\\chosen\\import.json',
    chooseExportPath: async () => 'C:\\chosen\\export.json'
  };
  const shell = {
    openPath: async (...args) => { calls.push(['openPath', ...args]); return ''; },
    setLaunchAtLogin: (...args) => calls.push(['setLaunchAtLogin', ...args]),
    minimize: () => calls.push(['minimize']),
    close: () => calls.push(['close']),
    syncSettings: (...args) => calls.push(['syncSettings', ...args])
  };
  const ipcMain = createRecordingIpcMain();
  const status = {
    getStatus: () => ({ warnings: [], dirty: false })
  };
  const desktop = {
    focus: (...args) => (calls.push(['focus', ...args]), true)
  };
  const dependencies = {
    ipcMain,
    engine: { ...engine, ...overrides.engine },
    store: { ...store, ...overrides.store },
    dialogs: { ...dialogs, ...overrides.dialogs },
    shell: { ...shell, ...overrides.shell },
    status: { ...status, ...overrides.status },
    desktop: { ...desktop, ...overrides.desktop },
    prepareState: overrides.prepareState || (() => ({ ok: true }))
  };
  return { calls, commandResult, dependencies, ipcMain, snapshot };
}

function register(harness) {
  assert.equal(typeof ipcModule.registerIpc, 'function');
  return ipcModule.registerIpc(harness.dependencies);
}

function invoke(harness, channel, ...args) {
  const handler = harness.ipcMain.handlers.get(channel);
  assert.equal(typeof handler, 'function', `missing handler ${channel}`);
  return handler({ sender: 'renderer' }, ...args);
}

test('registerIpc exposes only the fixed channel whitelist and dispose removes it', () => {
  const harness = createHarness();
  const registration = register(harness);

  assert.deepEqual([...harness.ipcMain.handlers.keys()].sort(), EXPECTED_CHANNELS);
  assert.equal(typeof registration.dispose, 'function');

  registration.dispose();
  assert.deepEqual(harness.ipcMain.removed.sort(), EXPECTED_CHANNELS);
  assert.equal(harness.ipcMain.handlers.size, 0);
});

test('task commands validate primitive input before calling the engine', async () => {
  const harness = createHarness();
  register(harness);

  assert.equal((await invoke(harness, 'task:add', 42)).ok, false);
  assert.equal((await invoke(harness, 'task:edit', '', 'text')).ok, false);
  assert.equal((await invoke(harness, 'task:toggle', ' bad id ')).ok, false);
  assert.equal((await invoke(harness, 'task:reorder', 'task-1', -1)).ok, false);
  assert.equal((await invoke(harness, 'history:delete-task', '2026-02-30', 'task-1')).ok, false);
  assert.equal((await invoke(harness, 'history:continue-task', '13/09/2026', 'task-1')).ok, false);
  assert.equal((await invoke(harness, 'undo:apply', null)).ok, false);
  assert.deepEqual(harness.calls, []);

  await invoke(harness, 'task:add', '学习 IPC');
  await invoke(harness, 'task:edit', 'task-1', '理解白名单');
  await invoke(harness, 'task:toggle', 'task-1');
  await invoke(harness, 'task:reorder', 'task-1', 0);
  await invoke(harness, 'task:delete-today', 'task-1');
  await invoke(harness, 'history:delete-task', '2026-09-12', 'task-2');
  await invoke(harness, 'history:continue-task', '2026-09-12', 'task-2');
  await invoke(harness, 'undo:apply', 'undo-1');

  assert.deepEqual(harness.calls.filter(([name]) => name !== 'save'), [
    ['addTask', '学习 IPC'],
    ['editTask', 'task-1', '理解白名单'],
    ['toggleTask', 'task-1'],
    ['reorderTask', 'task-1', 0],
    ['deleteTodayTask', 'task-1'],
    ['deleteHistoryTask', '2026-09-12', 'task-2'],
    ['continueTask', '2026-09-12', 'task-2'],
    ['undo', 'undo-1']
  ]);
  assert.equal(harness.calls.filter(([name]) => name === 'save').length, 8);
});

test('failed commands are not persisted and save failures become serializable results', async () => {
  const failedResult = { ok: false, error: '领域拒绝', snapshot: { marker: 'same' } };
  const rejected = createHarness({ engine: { addTask: () => failedResult } });
  register(rejected);
  assert.deepEqual(await invoke(rejected, 'task:add', '合法文本'), failedResult);
  assert.equal(rejected.calls.some(([name]) => name === 'save'), false);

  const dirtyErrors = [];
  const brokenDisk = createHarness({
    store: { save: () => { throw new Error('disk full'); } },
    status: { markDirty: (error) => dirtyErrors.push(error.message) }
  });
  register(brokenDisk);
  const result = await invoke(brokenDisk, 'task:add', '仍保留在内存');
  assert.equal(result.ok, false);
  assert.match(result.error, /保存失败.*disk full/);
  assert.deepEqual(result.snapshot, brokenDisk.commandResult.snapshot);
  assert.deepEqual(dirtyErrors, ['disk full']);
  // `applied` 告诉渲染进程「领域层已经接受了这次修改，只是没落盘」。
  // 少了它，界面分不清"引擎拒绝"和"存盘失败"，会把用户打的字留在输入框里，
  // 而那条任务其实已经出现在列表上了。
  assert.equal(result.applied, true);
});

test('a delete remains undoable when its state was applied but saving failed', async () => {
  const undoToken = 'undo-after-save-failure';
  const brokenDisk = createHarness({
    engine: {
      deleteTodayTask: () => ({ ok: true, snapshot: { marker: 'deleted-in-memory' }, undoToken })
    },
    store: { save: () => { throw new Error('disk full'); } }
  });
  register(brokenDisk);

  const result = await invoke(brokenDisk, 'task:delete-today', 'task-1');

  assert.equal(result.ok, false);
  assert.equal(result.applied, true);
  assert.equal(result.undoToken, undoToken, '保存失败不能丢弃领域引擎签发的撤销令牌');
  assert.deepEqual(result.snapshot, { marker: 'deleted-in-memory' });
});

test('engine rejections are not marked as applied', async () => {
  const harness = createHarness({
    engine: { addTask: () => ({ ok: false, error: '领域拒绝', snapshot: { marker: 'same' } }) }
  });
  register(harness);

  const result = await invoke(harness, 'task:add', '合法文本');

  assert.equal(result.ok, false);
  assert.equal(result.applied, undefined, '引擎拒绝时没有东西进列表，不能标记 applied');
});

test('settings reject coerced values and coordinate native effects', async () => {
  const harness = createHarness();
  register(harness);
  assert.equal((await invoke(harness, 'settings:set-close-to-tray', 1)).ok, false);
  assert.equal((await invoke(harness, 'settings:set-launch-at-login', 'yes')).ok, false);
  assert.deepEqual(harness.calls, []);
  await invoke(harness, 'settings:set-close-to-tray', false);
  await invoke(harness, 'settings:set-launch-at-login', true);

  assert.deepEqual(harness.calls.filter(([name]) => name === 'updateSettings'), [
    ['updateSettings', { closeToTray: false }],
    ['updateSettings', { launchAtLogin: true }]
  ]);
  assert.equal(harness.calls.some(([name, value]) => name === 'setLaunchAtLogin' && value === true), true);
});

test('native setting failures return the authoritative snapshot without mutating settings', async () => {
  const harness = createHarness({
    shell: { setLaunchAtLogin: () => { throw new Error('login item unavailable'); } }
  });
  register(harness);

  const result = await invoke(harness, 'settings:set-launch-at-login', true);

  assert.equal(result.ok, false);
  assert.match(result.error, /login item unavailable/);
  assert.deepEqual(result.snapshot, harness.snapshot);
  assert.equal(harness.calls.some(([name]) => name === 'updateSettings'), false);
});

test('settings commands refresh the native shell only after the state is persisted', async () => {
  const harness = createHarness();
  register(harness);

  await invoke(harness, 'settings:set-close-to-tray', false);

  assert.deepEqual(harness.calls.map(([name]) => name), ['updateSettings', 'save', 'syncSettings']);
});

test('failed settings commands do not refresh the native shell', async () => {
  const harness = createHarness({
    engine: { updateSettings: () => ({ ok: false, error: '领域拒绝', snapshot: { marker: 'same' } }) }
  });
  register(harness);

  const result = await invoke(harness, 'settings:set-close-to-tray', false);

  assert.equal(result.ok, false);
  assert.equal(harness.calls.some(([name]) => name === 'syncSettings'), false);
});

test('a login item the system rejects is never persisted', async () => {
  const harness = createHarness({
    shell: {
      setLaunchAtLogin: () => ({ ok: false, effective: false, error: '系统没有接受开机启动设置。' })
    }
  });
  register(harness);

  const result = await invoke(harness, 'settings:set-launch-at-login', true);

  assert.equal(result.ok, false);
  assert.match(result.error, /开机启动/);
  assert.deepEqual(result.snapshot, harness.snapshot);
  assert.equal(harness.calls.some(([name]) => name === 'updateSettings'), false);
});

test('state, data and window handlers use narrow adapters', async () => {
  const harness = createHarness();
  register(harness);

  assert.deepEqual(await invoke(harness, 'state:get-snapshot'), harness.snapshot);
  assert.deepEqual(await invoke(harness, 'app:get-status'), { warnings: [], dirty: false });
  assert.equal((await invoke(harness, 'data:import')).ok, true);
  assert.equal((await invoke(harness, 'data:export')).ok, true);
  assert.equal((await invoke(harness, 'data:open-folder')).ok, true);
  assert.equal((await invoke(harness, 'window:minimize')).ok, true);
  assert.equal((await invoke(harness, 'window:close')).ok, true);

  assert.deepEqual(harness.calls.filter(([name]) => [
    'importFrom', 'replaceState', 'exportTo', 'openPath', 'minimize', 'close'
  ].includes(name)), [
    ['importFrom', 'C:\\chosen\\import.json'],
    ['replaceState', { schemaVersion: 1, marker: 'imported' }],
    ['exportTo', 'C:\\chosen\\export.json', harness.snapshot],
    ['openPath', 'C:\\data'],
    ['minimize'],
    ['close']
  ]);
});

test('state commands prepare the local day before mutation and stop when preparation fails', async () => {
  const order = [];
  const harness = createHarness({
    prepareState: () => (order.push('prepare'), { ok: true }),
    engine: {
      addTask: () => (order.push('command'), {
        ok: true,
        snapshot: { schemaVersion: 1, marker: 'after-midnight' }
      })
    },
    store: { save: () => order.push('save') }
  });
  register(harness);

  await invoke(harness, 'task:add', '跨夜后的任务');
  assert.deepEqual(order, ['prepare', 'command', 'save']);

  const blocked = createHarness({
    prepareState: () => ({ ok: false, error: '日期准备失败', snapshot: { marker: 'old' } })
  });
  register(blocked);
  assert.deepEqual(await invoke(blocked, 'task:add', '不应执行'), {
    ok: false, error: '日期准备失败', snapshot: { marker: 'old' }
  });
  assert.deepEqual(blocked.calls, []);
});

test('open data folder reports Electron openPath error strings', async () => {
  const harness = createHarness({
    shell: { openPath: async () => 'Access is denied' }
  });
  register(harness);

  const result = await invoke(harness, 'data:open-folder');

  assert.equal(result.ok, false);
  assert.match(result.error, /Access is denied/);
});

test('import returns the prepared current-day snapshot instead of the stale imported snapshot', async () => {
  const preparedSnapshot = { schemaVersion: 1, marker: 'rolled-to-today' };
  const harness = createHarness({
    prepareState: () => ({ ok: true, snapshot: preparedSnapshot })
  });
  register(harness);

  const result = await invoke(harness, 'data:import');

  assert.deepEqual(result, { ok: true, snapshot: preparedSnapshot });
});

test('import clears old dirty status, then reports a rollover persistence failure', async () => {
  const events = [];
  const currentSnapshot = { schemaVersion: 1, marker: 'rolled-in-memory' };
  const harness = createHarness({
    status: { markSaved: () => events.push('clean') },
    prepareState: () => ({
      ok: false,
      error: '跨日状态保存失败：disk full',
      snapshot: currentSnapshot
    })
  });
  register(harness);

  const result = await invoke(harness, 'data:import');

  assert.deepEqual(events, ['clean']);
  assert.deepEqual(result, {
    ok: false,
    error: '跨日状态保存失败：disk full',
    snapshot: currentSnapshot
  });
});

test('cancelled native dialogs are reported as cancellations, not failures', async () => {
  const cancelled = createHarness({
    dialogs: { chooseImportPath: async () => null, chooseExportPath: async () => null }
  });
  register(cancelled);

  assert.deepEqual(await invoke(cancelled, 'data:import'), { ok: false, cancelled: true });
  assert.deepEqual(await invoke(cancelled, 'data:export'), { ok: false, cancelled: true });
  assert.deepEqual(cancelled.calls, []);
});

test('a rejected import leaves the in-memory state untouched', async () => {
  const harness = createHarness({
    store: { importFrom: () => { throw new Error('导入文件不是有效的 JSON 状态。'); } }
  });
  register(harness);

  const result = await invoke(harness, 'data:import');

  assert.equal(result.ok, false);
  assert.match(result.error, /有效的 JSON/);
  assert.deepEqual(result.snapshot, harness.snapshot);
  assert.equal(harness.calls.some(([name]) => name === 'replaceState'), false);
  assert.equal(harness.calls.some(([name]) => name === 'save'), false);
});

test('a rejected import never replaces the engine state', async () => {
  const harness = createHarness({
    engine: { replaceState: () => ({ ok: false, error: '导入状态无效。', snapshot: { marker: 'old' } }) }
  });
  register(harness);

  const result = await invoke(harness, 'data:import');

  assert.equal(result.ok, false);
  assert.match(result.error, /导入状态无效/);
  assert.deepEqual(result.snapshot, { marker: 'old' });
});

test('export reports the destination path and surfaces write failures', async () => {
  const ok = createHarness({ store: { exportTo: () => 'C:\\chosen\\export.json' } });
  register(ok);
  assert.deepEqual(await invoke(ok, 'data:export'), { ok: true, path: 'C:\\chosen\\export.json' });

  const broken = createHarness({
    store: { exportTo: () => { throw new Error('无法安全写入状态文件：disk full'); } }
  });
  register(broken);
  const failure = await invoke(broken, 'data:export');
  assert.equal(failure.ok, false);
  assert.match(failure.error, /disk full/);
});

test('import surfaces the preserved corrupt-file paths through the runtime status', async () => {
  const warnings = ['当前状态文件已损坏，已保留原文件并从备份恢复。'];
  const harness = createHarness({
    status: { getStatus: () => ({ warnings, dirty: false }) }
  });
  register(harness);

  assert.deepEqual(await invoke(harness, 'app:get-status'), { warnings, dirty: false });
});

test('点窗口这一下只做一件事：把键盘焦点补回去', async () => {
  const harness = createHarness();
  register(harness);

  assert.deepEqual(await invoke(harness, 'window:request-desktop-focus'), { ok: true, focused: true });
  assert.deepEqual(harness.calls, [['focus']]);
});

test('补焦点失败也只是如实报告，不打扰用户', async () => {
  const harness = createHarness({ desktop: { focus: () => false } });
  register(harness);

  // 没挂进桌面、或者系统不给焦点，都不该变成一条报错弹窗。
  assert.deepEqual(await invoke(harness, 'window:request-desktop-focus'), { ok: true, focused: false });
});
