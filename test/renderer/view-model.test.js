const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTodayView, deriveHistoryView, deriveSettingsView, formatDateLabel, resolveDropIndex } =
  require('../../src/renderer/view-model');

function makeTask(id, overrides = {}) {
  return {
    id,
    text: `任务 ${id}`,
    completed: false,
    createdAt: '2026-09-13T08:00:00.000+08:00',
    completedAt: null,
    continuedFromTaskId: null,
    continuedFromDate: null,
    continuedToTaskId: null,
    continuedToDate: null,
    hasBeenContinued: false,
    ...overrides
  };
}

function makeSnapshot(tasks) {
  return {
    schemaVersion: 1,
    activeDay: { date: '2026-09-13', closedAt: null, tasks },
    history: [],
    settings: { backgroundOpacity: 0.82, windowMode: 'topmost', closeToTray: true, launchAtLogin: false },
    windowBounds: { width: 390, height: 610 }
  };
}

function makeDay(date, tasks) {
  return { date, closedAt: `${date}T23:59:00.000+08:00`, tasks };
}

function makeHistorySnapshot(history, settings) {
  const snapshot = makeSnapshot([]);
  snapshot.history = history;
  if (settings) snapshot.settings = { ...snapshot.settings, ...settings };
  return snapshot;
}

test('formatDateLabel 输出本地月日与星期', () => {
  assert.equal(formatDateLabel('2026-09-13'), '9月13日 周日');
  assert.equal(formatDateLabel('2026-09-14'), '9月14日 周一');
  assert.equal(formatDateLabel('2026-01-01'), '1月1日 周四');
});

test('formatDateLabel 对非法日期返回空字符串', () => {
  assert.equal(formatDateLabel('2026-02-30'), '');
  assert.equal(formatDateLabel('2026/09/13'), '');
  assert.equal(formatDateLabel(undefined), '');
});

test('deriveTodayView 投影日期与标题', () => {
  const view = deriveTodayView(makeSnapshot([]));
  assert.equal(view.date, '2026-09-13');
  assert.equal(view.dateLabel, '9月13日 周日');
});

test('deriveTodayView 保持任务顺序并投影每行的位置', () => {
  const view = deriveTodayView(makeSnapshot([makeTask('a'), makeTask('b'), makeTask('c')]));
  assert.deepEqual(view.tasks.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(view.tasks.map((row) => row.position), [0, 1, 2]);
  assert.deepEqual(view.tasks.map((row) => row.text), ['任务 a', '任务 b', '任务 c']);
});

test('deriveTodayView 统计完成数与总数', () => {
  const view = deriveTodayView(makeSnapshot([
    makeTask('a', { completed: true, completedAt: '2026-09-13T09:00:00.000+08:00' }),
    makeTask('b'),
    makeTask('c', { completed: true, completedAt: '2026-09-13T10:00:00.000+08:00' }),
    makeTask('d')
  ]));
  assert.equal(view.todayCount, 4);
  assert.equal(view.completedCount, 2);
  assert.equal(view.remainingCount, 2);
  assert.equal(view.progressLabel, '2 / 4');
  assert.equal(view.progressRatio, 0.5);
  assert.equal(view.progressPercent, 50);
});

test('deriveTodayView 在空清单时把进度归零而不是 NaN', () => {
  const view = deriveTodayView(makeSnapshot([]));
  assert.equal(view.todayCount, 0);
  assert.equal(view.progressRatio, 0);
  assert.equal(view.progressPercent, 0);
  assert.equal(view.progressLabel, '0 / 0');
});

test('deriveTodayView 对进度百分比取整', () => {
  const view = deriveTodayView(makeSnapshot([
    makeTask('a', { completed: true, completedAt: '2026-09-13T09:00:00.000+08:00' }),
    makeTask('b'),
    makeTask('c')
  ]));
  assert.equal(view.progressRatio, 1 / 3);
  assert.equal(view.progressPercent, 33);
});

test('deriveTodayView 的任务行只暴露界面用得到的字段', () => {
  const view = deriveTodayView(makeSnapshot([
    makeTask('a', { continuedFromTaskId: 'old-1', continuedFromDate: '2026-09-12' })
  ]));
  // 行上不再有「延续」角标，投影也就不再带这部分字段。
  assert.deepEqual(Object.keys(view.tasks[0]).sort(), ['completed', 'completedAt', 'id', 'position', 'text']);
  assert.equal(view.tasks[0].text, '任务 a');
});

test('deriveTodayView 在空清单时给出空状态文案，非空时为 null', () => {
  const empty = deriveTodayView(makeSnapshot([]));
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.hasTasks, false);
  assert.deepEqual(empty.empty, { title: '清单空空的', copy: '写下一件小事，然后轻松完成它。' });

  const filled = deriveTodayView(makeSnapshot([makeTask('a')]));
  assert.equal(filled.isEmpty, false);
  assert.equal(filled.hasTasks, true);
  assert.equal(filled.empty, null);
});

test('deriveTodayView 不修改传入的快照', () => {
  const snapshot = makeSnapshot([makeTask('a', { completed: true, completedAt: '2026-09-13T09:00:00.000+08:00' })]);
  const before = JSON.stringify(snapshot);
  const view = deriveTodayView(snapshot);
  view.tasks[0].text = '被改写了';
  view.empty = '被改写了';
  assert.equal(JSON.stringify(snapshot), before);
});

test('deriveTodayView 拒绝结构不合法的快照', () => {
  assert.throws(() => deriveTodayView(null), TypeError);
  assert.throws(() => deriveTodayView({}), TypeError);
  assert.throws(() => deriveTodayView({ activeDay: { date: '2026-09-13' } }), TypeError);
  assert.throws(() => deriveTodayView({ activeDay: { date: '2026-09-13', tasks: {} } }), TypeError);
});

/* ---------- History ---------- */

test('deriveHistoryView 按日期倒序排列，不依赖输入顺序', () => {
  const view = deriveHistoryView(makeHistorySnapshot([
    makeDay('2026-09-11', [makeTask('a')]),
    makeDay('2026-09-13', [makeTask('b')]),
    makeDay('2026-09-12', [makeTask('c')])
  ]));
  assert.deepEqual(view.days.map((day) => day.date), ['2026-09-13', '2026-09-12', '2026-09-11']);
  assert.deepEqual(view.days.map((day) => day.dateLabel), ['9月13日 周日', '9月12日 周六', '9月11日 周五']);
  assert.equal(view.dayCount, 3);
  assert.equal(view.isEmpty, false);
  assert.equal(view.empty, null);
});

test('deriveHistoryView 统计每天的完成情况', () => {
  const view = deriveHistoryView(makeHistorySnapshot([
    makeDay('2026-09-12', [
      makeTask('a', { completed: true, completedAt: '2026-09-12T09:00:00.000+08:00' }),
      makeTask('b'),
      makeTask('c', { completed: true, completedAt: '2026-09-12T10:00:00.000+08:00' })
    ])
  ]));
  const day = view.days[0];
  assert.equal(day.taskCount, 3);
  assert.equal(day.completedCount, 2);
  assert.equal(day.progressLabel, '2 / 3');
  assert.deepEqual(day.tasks.map((row) => row.position), [0, 1, 2]);
});

test('deriveHistoryView 在空历史时给出空状态文案', () => {
  const view = deriveHistoryView(makeHistorySnapshot([]));
  assert.equal(view.isEmpty, true);
  assert.equal(view.dayCount, 0);
  assert.deepEqual(view.days, []);
  assert.deepEqual(view.empty, { title: '还没有历史记录', copy: '每过一天，当天的清单会完整留在这里。' });
});

test('历史行只在未完成且从未延续时允许延续', () => {
  const view = deriveHistoryView(makeHistorySnapshot([
    makeDay('2026-09-12', [
      makeTask('open'),
      makeTask('done', { completed: true, completedAt: '2026-09-12T09:00:00.000+08:00' }),
      makeTask('already', { hasBeenContinued: true, continuedToTaskId: 't-1', continuedToDate: '2026-09-13' }),
      makeTask('linked', { continuedToTaskId: 't-2', continuedToDate: '2026-09-13' })
    ])
  ]));
  const rows = view.days[0].tasks;
  assert.equal(rows[0].canContinue, true);
  assert.equal(rows[1].canContinue, false);
  assert.equal(rows[2].canContinue, false);
  assert.equal(rows[3].canContinue, false);
});

test('历史行给延续关系生成可读标签', () => {
  const view = deriveHistoryView(makeHistorySnapshot([
    makeDay('2026-09-12', [
      makeTask('open'),
      makeTask('done', { completed: true, completedAt: '2026-09-12T09:00:00.000+08:00' }),
      makeTask('already', { hasBeenContinued: true, continuedToTaskId: 't-1', continuedToDate: '2026-09-13' }),
      makeTask('flag-only', { hasBeenContinued: true }),
      makeTask('carried', { continuedFromTaskId: 'old-1', continuedFromDate: '2026-09-11' })
    ])
  ]));
  const rows = view.days[0].tasks;
  assert.equal(rows[0].statusLabel, null);
  assert.equal(rows[1].statusLabel, null);
  assert.equal(rows[2].statusLabel, '已延续到 9月13日 周日');
  assert.equal(rows[3].statusLabel, '已延续过');
  assert.equal(rows[4].statusLabel, '延续自 9月11日 周五');
  assert.equal(rows[4].isContinuedFrom, true);
  assert.equal(rows[4].continuedFromDate, '2026-09-11');
  assert.equal(rows[4].canContinue, true);
});

test('deriveHistoryView 不修改传入的快照', () => {
  const snapshot = makeHistorySnapshot([
    makeDay('2026-09-12', [makeTask('b'), makeTask('a')]),
    makeDay('2026-09-11', [makeTask('c')])
  ]);
  const before = JSON.stringify(snapshot);
  const view = deriveHistoryView(snapshot);
  view.days[0].tasks[0].text = '被改写了';
  view.days.reverse();
  assert.equal(JSON.stringify(snapshot), before);
});

test('deriveHistoryView 拒绝结构不合法的快照', () => {
  assert.throws(() => deriveHistoryView(null), TypeError);
  assert.throws(() => deriveHistoryView({}), TypeError);
});

/* ---------- Settings ---------- */

test('deriveSettingsView 只投影两个原生开关，窗口层级已经不存在', () => {
  const view = deriveSettingsView(makeSnapshot([]));
  assert.equal(view.closeToTray, true);
  assert.equal(view.launchAtLogin, false);
  // 三种窗口层级（普通/置顶/桌面）整套删掉了：它是个多余的概念，
  // 用户得先学会三种层级才能选，而实际想要的只是"常驻桌面的小部件"。
  // 这条断言防的是有人把概念加回来时忘了同步投影。
  assert.equal('windowMode' in view, false);
  assert.equal('windowModes' in view, false);
  // 背景透明度是固定的视觉常量，不再是一项可由用户调整的设置。
  assert.equal('opacityPercent' in view, false);
  assert.equal('backgroundOpacity' in view, false);
});

test('deriveSettingsView 把开关类设置强制成布尔值', () => {
  const view = deriveSettingsView(makeHistorySnapshot([], { closeToTray: 0, launchAtLogin: 'yes' }));
  assert.equal(view.closeToTray, false);
  assert.equal(view.launchAtLogin, true);
});

/* ---------- 拖拽落点 ---------- */

test('拖到某一行上就插到那一行之后（往下拖）', () => {
  // 4 行、每行 42px。被拖的是完整列表里的第 0 行，所以 others 是原来的第 1~4 行。
  const rows = [
    { top: 100, bottom: 142 },
    { top: 142, bottom: 184 },
    { top: 184, bottom: 226 },
    { top: 226, bottom: 268 }
  ];

  // 指针落在 others[1]（完整列表的第 2 行）上 → 插到它后面
  assert.deepEqual(resolveDropIndex(rows, 160, 0), { targetIndex: 2, markerIndex: 1, side: 'after' });
  // 落在第一行上 → 插到它后面，也就是往下挪一位
  assert.deepEqual(resolveDropIndex(rows, 110, 0), { targetIndex: 1, markerIndex: 0, side: 'after' });
});

test('拖到某一行上就插到那一行之前（往上拖）', () => {
  const rows = [
    { top: 100, bottom: 142 },
    { top: 142, bottom: 184 },
    { top: 184, bottom: 226 },
    { top: 226, bottom: 268 }
  ];

  // 被拖的是完整列表第 2 行。指针落在 others[0]（第 0 行）上 → 插到它前面
  assert.deepEqual(resolveDropIndex(rows, 110, 2), { targetIndex: 0, markerIndex: 0, side: 'before' });
  // 落在 others[1]（第 1 行）上 → 插到它前面，也就是往上挪一位
  assert.deepEqual(resolveDropIndex(rows, 160, 2), { targetIndex: 1, markerIndex: 1, side: 'before' });
});

test('拖到列表上下方的空白里就是开头或末尾', () => {
  const rows = [{ top: 100, bottom: 142 }, { top: 142, bottom: 184 }];
  assert.deepEqual(resolveDropIndex(rows, 50, 3), { targetIndex: 0, markerIndex: 0, side: 'before' });
  assert.deepEqual(resolveDropIndex(rows, 900, 3), { targetIndex: 2, markerIndex: 1, side: 'after' });
});

test('把第 1 行拖到第 3 行，结果就是跟第 3 行换位', () => {
  // 真机验收报过："我 1 和 3 换位，结果是 1 和 2 换位"。
  // 这条按结果断言，避免再把"越过中线才算插到后面"那种差半行的语义当成功。
  const list = ['A', 'B', 'C', 'D', 'E'];
  const others = list.slice(1);
  const rows = others.map((_, index) => ({ top: 100 + index * 42, bottom: 142 + index * 42 }));
  // 指针落在 C 那一行（others[1]）的上半部分 —— 旧规则在这里会插到 C 之前
  const outcome = resolveDropIndex(rows, 100 + 42 + 10, 0);
  const reordered = [...others];
  reordered.splice(outcome.targetIndex, 0, list[0]);
  assert.deepEqual(reordered, ['B', 'C', 'A', 'D', 'E']);
});

test('resolveDropIndex 对空列表和非法输入返回 -1', () => {
  assert.deepEqual(resolveDropIndex([], 5, 0), { targetIndex: -1, markerIndex: -1, side: null });
  assert.deepEqual(resolveDropIndex(null, 5, 0), { targetIndex: -1, markerIndex: -1, side: null });
  assert.deepEqual(resolveDropIndex([{ top: 0, bottom: 10 }], NaN, 0), { targetIndex: -1, markerIndex: -1, side: null });
});
