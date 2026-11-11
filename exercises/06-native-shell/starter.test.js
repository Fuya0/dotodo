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
  assert.deepEqual(planTrayMenu({ closeToTray: true, launchAtLogin: false }), [
    { id: 'show', label: '显示在桌面', type: 'normal', checked: false },
    { id: 'hide', label: '从桌面隐藏', type: 'normal', checked: false },
    { id: 'closeToTray', label: '关闭时隐藏到托盘', type: 'checkbox', checked: true },
    { id: 'launchAtLogin', label: '开机启动', type: 'checkbox', checked: false },
    { id: 'quit', label: '退出 DoTodo', type: 'normal', checked: false }
  ]);
});

test('planTrayMenu 缺值时全部不勾，且不含窗口层级项', () => {
  const plan = planTrayMenu({ closeToTray: true });
  assert.equal(plan.find((item) => item.id === 'closeToTray').checked, true);
  assert.equal(plan.find((item) => item.id === 'launchAtLogin').checked, false);
  // 窗口层级已经删掉，菜单里不该再出现这一项。
  assert.equal(plan.some((item) => item.id === 'topmost'), false);

  const empty = planTrayMenu(undefined);
  assert.deepEqual(empty.filter((item) => item.checked), []);
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
