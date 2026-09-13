const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTodayView, formatDateLabel } = require('../../src/renderer/view-model');

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

test('deriveTodayView 标记延续而来的任务并保留来源日期', () => {
  const view = deriveTodayView(makeSnapshot([
    makeTask('a', { continuedFromTaskId: 'old-1', continuedFromDate: '2026-09-12' }),
    makeTask('b')
  ]));
  assert.equal(view.tasks[0].isContinued, true);
  assert.equal(view.tasks[0].continuedFromDate, '2026-09-12');
  assert.equal(view.tasks[1].isContinued, false);
  assert.equal(view.tasks[1].continuedFromDate, null);
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
