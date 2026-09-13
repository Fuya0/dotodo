const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planTrayMenu,
  shouldHideOnClose,
  reconcileLaunchAtLogin,
  describeWindowMode,
  formatShortcut,
  summarizeShellBoot
} = require('./starter');

test('planTrayMenu 把设置投影成可序列化的菜单计划', () => {
  assert.deepEqual(planTrayMenu({ windowMode: 'topmost', closeToTray: true, launchAtLogin: false }), [
    { id: 'show', label: '显示 DoTodo', type: 'normal', checked: false },
    { id: 'hide', label: '隐藏 DoTodo', type: 'normal', checked: false },
    { id: 'topmost', label: '窗口置顶', type: 'checkbox', checked: true },
    { id: 'closeToTray', label: '关闭时隐藏到托盘', type: 'checkbox', checked: true },
    { id: 'launchAtLogin', label: '开机启动', type: 'checkbox', checked: false },
    { id: 'quit', label: '退出 DoTodo', type: 'normal', checked: false }
  ]);
});

test('planTrayMenu 只用 windowMode 决定置顶勾选，缺值时全部不勾', () => {
  const plan = planTrayMenu({ windowMode: 'normal' });
  assert.equal(plan.find((item) => item.id === 'topmost').checked, false);
  assert.equal(plan.find((item) => item.id === 'closeToTray').checked, false);

  const empty = planTrayMenu(undefined);
  assert.equal(empty.length, 6);
  assert.deepEqual(empty.filter((item) => item.checked), []);
});

test('planTrayMenu 只在桌面模式下不算置顶', () => {
  for (const mode of ['normal', 'desktop']) {
    assert.equal(planTrayMenu({ windowMode: mode }).find((item) => item.id === 'topmost').checked, false);
  }
  assert.equal(planTrayMenu({ windowMode: 'topmost' }).find((item) => item.id === 'topmost').checked, true);
});

test('shouldHideOnClose 只在「开了托盘、没在建托盘、真的退出中」时隐藏', () => {
  assert.equal(shouldHideOnClose({ closeToTray: true, isQuitting: false, hasTray: true }), true);
  assert.equal(shouldHideOnClose({ closeToTray: true, isQuitting: true, hasTray: true }), false);
  assert.equal(shouldHideOnClose({ closeToTray: false, isQuitting: false, hasTray: true }), false);
  assert.equal(shouldHideOnClose({ closeToTray: true, isQuitting: false, hasTray: false }), false);
  assert.equal(shouldHideOnClose({}), false);
});

test('reconcileLaunchAtLogin 用读回值判断设置是否真的生效', () => {
  assert.deepEqual(reconcileLaunchAtLogin(true, true), { ok: true, effective: true, rollback: false });
  assert.deepEqual(reconcileLaunchAtLogin(false, false), { ok: true, effective: false, rollback: false });
  assert.deepEqual(reconcileLaunchAtLogin(true, false), { ok: false, effective: false, rollback: true });
  assert.deepEqual(reconcileLaunchAtLogin(false, true), { ok: false, effective: true, rollback: true });
});

test('reconcileLaunchAtLogin 在系统不给读回值时信任请求', () => {
  assert.deepEqual(reconcileLaunchAtLogin(true, undefined), { ok: true, effective: true, rollback: false });
  assert.deepEqual(reconcileLaunchAtLogin(false, null), { ok: true, effective: false, rollback: false });
});

test('describeWindowMode 对真正有官方 API 的模式标记为 exact', () => {
  assert.deepEqual(describeWindowMode('win32', 'normal'), { mode: 'normal', exact: true, note: null });
  assert.deepEqual(describeWindowMode('darwin', 'topmost'), { mode: 'topmost', exact: true, note: null });
  assert.deepEqual(describeWindowMode('linux', 'topmost'), { mode: 'topmost', exact: true, note: null });
});

test('describeWindowMode 坦白桌面层级只是近似，并且区分平台', () => {
  const windows = describeWindowMode('win32', 'desktop');
  assert.equal(windows.mode, 'desktop');
  assert.equal(windows.exact, false);
  assert.match(windows.note, /近似/);

  const mac = describeWindowMode('darwin', 'desktop');
  assert.equal(mac.exact, false);
  assert.match(mac.note, /macOS/);
});

test('describeWindowMode 对不支持的平台和未知模式返回 null', () => {
  assert.equal(describeWindowMode('linux', 'desktop'), null);
  assert.equal(describeWindowMode('win32', 'floating-magic'), null);
  assert.equal(describeWindowMode('win32', ''), null);
});

test('formatShortcut 按平台把加速键转成用户看得懂的样子', () => {
  assert.equal(formatShortcut('CommandOrControl+Shift+Space', 'win32'), 'Ctrl + Shift + Space');
  assert.equal(formatShortcut('CommandOrControl+Shift+Space', 'darwin'), '⌘ + Shift + Space');
  assert.equal(formatShortcut('CommandOrControl+N', 'linux'), 'Ctrl + N');
  assert.equal(formatShortcut('F2', 'win32'), 'F2');
});

test('formatShortcut 对空输入返回空字符串', () => {
  assert.equal(formatShortcut('', 'win32'), '');
  assert.equal(formatShortcut(null, 'win32'), '');
  assert.equal(formatShortcut(undefined, 'darwin'), '');
});

test('summarizeShellBoot 把启动结果压成一句状态', () => {
  assert.deepEqual(summarizeShellBoot({
    trayCreated: true,
    shortcut: { registered: true, warning: null },
    warnings: []
  }), { tray: 'ready', shortcut: 'ready', messages: [] });

  assert.deepEqual(summarizeShellBoot({
    trayCreated: false,
    shortcut: { registered: false, warning: '已被占用' },
    warnings: ['托盘图标创建失败：x', '已被占用']
  }), { tray: 'unavailable', shortcut: 'conflict', messages: ['托盘图标创建失败：x', '已被占用'] });
});

test('summarizeShellBoot 容忍缺失字段并过滤空警告', () => {
  assert.deepEqual(summarizeShellBoot({}), { tray: 'unavailable', shortcut: 'conflict', messages: [] });
  assert.deepEqual(summarizeShellBoot({ trayCreated: true, warnings: ['', null, undefined, '真的警告'] }), {
    tray: 'ready',
    shortcut: 'conflict',
    messages: ['真的警告']
  });
});
