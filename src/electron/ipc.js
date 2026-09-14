const path = require('node:path');

const WINDOW_MODES = Object.freeze(['normal', 'topmost', 'desktop']);

const CHANNELS = Object.freeze({
  getSnapshot: 'state:get-snapshot',
  getStatus: 'app:get-status',
  addTask: 'task:add',
  editTask: 'task:edit',
  toggleTask: 'task:toggle',
  reorderTask: 'task:reorder',
  deleteTodayTask: 'task:delete-today',
  deleteHistoryTask: 'history:delete-task',
  continueTask: 'history:continue-task',
  undo: 'undo:apply',
  setWindowMode: 'settings:set-window-mode',
  setCloseToTray: 'settings:set-close-to-tray',
  setLaunchAtLogin: 'settings:set-launch-at-login',
  importData: 'data:import',
  exportData: 'data:export',
  openDataFolder: 'data:open-folder',
  minimizeWindow: 'window:minimize',
  closeWindow: 'window:close'
});

function registerIpc({ ipcMain, engine, store, dialogs, shell, status, prepareState }) {
  assertDependencies(ipcMain, engine, store, dialogs, shell, status, prepareState);
  const registeredChannels = [];

  function handle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        return failure(`操作失败：${errorMessage(error)}`, engine.getSnapshot());
      }
    });
    registeredChannels.push(channel);
  }

  function invalidInput(message) {
    return failure(message, engine.getSnapshot());
  }

  function handleState(channel, handler) {
    handle(channel, async (event, ...args) => {
      const preparation = await prepareState();
      if (preparation && preparation.ok === false) return preparation;
      return handler(event, ...args);
    });
  }

  function runCommand(command) {
    const result = command();
    if (!result || result.ok !== true) return result;
    try {
      store.save(result.snapshot);
      if (typeof status.markSaved === 'function') status.markSaved();
      return result;
    } catch (error) {
      if (typeof status.markDirty === 'function') status.markDirty(error);
      // `applied: true` 是关键：领域层已经接受了这次修改（快照里有它），只有落盘失败了。
      // 渲染进程分不清"引擎拒绝"和"存盘失败"的话，就会把用户刚打的字留在输入框里，
      // 而那条任务其实已经出现在列表上了——再按一次回车就会重复一条。
      return failure(`保存失败：${errorMessage(error)}`, result.snapshot, { applied: true });
    }
  }

  handleState(CHANNELS.getSnapshot, () => engine.getSnapshot());
  handle(CHANNELS.getStatus, () => status.getStatus());

  handleState(CHANNELS.addTask, (_event, text) => {
    if (!isTaskText(text)) return invalidInput('任务内容必须是 1 到 240 个字符的文本。');
    return runCommand(() => engine.addTask(text));
  });

  handleState(CHANNELS.editTask, (_event, id, text) => {
    if (!isIdentifier(id) || !isTaskText(text)) return invalidInput('任务 ID 或内容无效。');
    return runCommand(() => engine.editTask(id, text));
  });

  handleState(CHANNELS.toggleTask, (_event, id) => {
    if (!isIdentifier(id)) return invalidInput('任务 ID 无效。');
    return runCommand(() => engine.toggleTask(id));
  });

  handleState(CHANNELS.reorderTask, (_event, id, targetIndex) => {
    if (!isIdentifier(id) || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 9999) {
      return invalidInput('任务 ID 或目标位置无效。');
    }
    return runCommand(() => engine.reorderTask(id, targetIndex));
  });

  handleState(CHANNELS.deleteTodayTask, (_event, id) => {
    if (!isIdentifier(id)) return invalidInput('任务 ID 无效。');
    return runCommand(() => engine.deleteTodayTask(id));
  });

  handleState(CHANNELS.deleteHistoryTask, (_event, date, id) => {
    if (!isLocalDate(date) || !isIdentifier(id)) return invalidInput('历史日期或任务 ID 无效。');
    return runCommand(() => engine.deleteHistoryTask(date, id));
  });

  handleState(CHANNELS.continueTask, (_event, date, id) => {
    if (!isLocalDate(date) || !isIdentifier(id)) return invalidInput('历史日期或任务 ID 无效。');
    return runCommand(() => engine.continueTask(date, id));
  });

  handleState(CHANNELS.undo, (_event, token) => {
    if (!isIdentifier(token)) return invalidInput('撤销令牌无效。');
    return runCommand(() => engine.undo(token));
  });

  /**
   * 原生设置生效且成功落盘之后，才让壳层重建托盘菜单。
   * 顺序不能颠倒，否则菜单会显示成还没写盘的旧值。
   *
   * 适配器可能回传一段平台差异说明（例如桌面层级只是近似实现）。这里**故意不转发**：
   * 那段话写在 README 和课程里就够了，做成每次切换都弹的提示只会变成噪音。
   */
  function afterNativeChange(result) {
    if (result.ok !== true) return result;
    if (typeof shell.syncSettings === 'function') shell.syncSettings(result.snapshot.settings);
    return result;
  }

  handleState(CHANNELS.setWindowMode, async (_event, value) => {
    if (!WINDOW_MODES.includes(value)) return invalidInput('窗口模式无效。');
    const applied = await shell.setWindowMode(value);
    if (applied && applied.ok === false) return failure(applied.error, engine.getSnapshot());
    return afterNativeChange(runCommand(() => engine.updateSettings({ windowMode: value })));
  });

  handleState(CHANNELS.setCloseToTray, (_event, value) => {
    if (typeof value !== 'boolean') return invalidInput('关闭到托盘设置必须是布尔值。');
    return afterNativeChange(runCommand(() => engine.updateSettings({ closeToTray: value })));
  });

  handleState(CHANNELS.setLaunchAtLogin, async (_event, value) => {
    if (typeof value !== 'boolean') return invalidInput('开机启动设置必须是布尔值。');
    const applied = await shell.setLaunchAtLogin(value);
    // 系统没有接受就不要落盘，否则界面会显示一个其实没生效的开关。
    if (applied && applied.ok === false) return failure(applied.error, engine.getSnapshot());
    return afterNativeChange(runCommand(() => engine.updateSettings({ launchAtLogin: value })));
  });

  handle(CHANNELS.importData, async () => {
    const sourcePath = await dialogs.chooseImportPath();
    if (!sourcePath) return { ok: false, cancelled: true };
    const imported = store.importFrom(sourcePath);
    if (typeof status.markSaved === 'function') status.markSaved();
    const replacement = engine.replaceState(imported);
    if (!replacement.ok) return replacement;
    const preparation = await prepareState();
    if (preparation && preparation.ok === false) return preparation;
    return preparation?.snapshot
      ? { ok: true, snapshot: preparation.snapshot }
      : replacement;
  });

  handleState(CHANNELS.exportData, async () => {
    const destinationPath = await dialogs.chooseExportPath();
    if (!destinationPath) return { ok: false, cancelled: true };
    store.exportTo(destinationPath, engine.getSnapshot());
    return { ok: true, path: destinationPath };
  });

  handle(CHANNELS.openDataFolder, async () => {
    const dataDirectory = path.dirname(store.getPaths().primary);
    const openError = await shell.openPath(dataDirectory);
    if (typeof openError === 'string' && openError) throw new Error(openError);
    return { ok: true, path: dataDirectory };
  });

  handle(CHANNELS.minimizeWindow, async () => {
    await shell.minimize();
    return { ok: true };
  });

  handle(CHANNELS.closeWindow, async () => {
    await shell.close();
    return { ok: true };
  });

  return Object.freeze({
    dispose() {
      for (const channel of registeredChannels) ipcMain.removeHandler(channel);
      registeredChannels.length = 0;
    }
  });
}

function assertDependencies(ipcMain, engine, store, dialogs, shell, status, prepareState) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function' ||
      !engine || typeof engine.getSnapshot !== 'function' ||
      !store || typeof store.save !== 'function' ||
      !dialogs || typeof dialogs.chooseImportPath !== 'function' ||
      !shell || typeof shell.close !== 'function' ||
      !status || typeof status.getStatus !== 'function' ||
      typeof prepareState !== 'function') {
    throw new TypeError('IPC 注册需要完整且受限的主进程适配器。');
  }
}

function isTaskText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 240;
}

function isIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function failure(error, snapshot, extra) {
  if (snapshot === undefined) return { ok: false, error };
  return extra ? { ok: false, error, snapshot, ...extra } : { ok: false, error, snapshot };
}

module.exports = { CHANNELS, registerIpc };
