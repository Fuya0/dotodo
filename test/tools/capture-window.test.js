const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDemoState, localDate, instant } = require('../../tools/capture-window');
const { validateState } = require('../../src/domain/state-schema');

test('截图用的演示数据必须是合法状态', () => {
  const result = validateState(buildDemoState());
  assert.equal(result.ok, true, result.ok ? '' : result.error);
});

test('演示数据里每一条任务的完成时间都不早于创建时间', () => {
  const state = buildDemoState();
  const allTasks = [...state.activeDay.tasks, ...state.history.flatMap((day) => day.tasks)];
  assert.ok(allTasks.length > 0);
  for (const task of allTasks) {
    if (task.completed) {
      assert.ok(
        Date.parse(task.completedAt) >= Date.parse(task.createdAt),
        `任务「${task.text}」的完成时间早于创建时间。`
      );
    }
  }
});

test('演示数据的历史日期早于今天并且倒序', () => {
  const state = buildDemoState();
  assert.equal(state.activeDay.date, localDate(0));
  assert.deepEqual(state.history.map((day) => day.date), [localDate(-1)]);
  for (const day of state.history) {
    assert.ok(day.date < state.activeDay.date);
    assert.match(day.closedAt, /^\d{4}-\d{2}-\d{2}T23:59:00\.000[+-]\d{2}:\d{2}$/);
  }
});

test('instant 拼出带本地时区偏移的 ISO 时间', () => {
  assert.match(instant('2026-09-13', '08:00:00.000'), /^2026-09-13T08:00:00\.000[+-]\d{2}:\d{2}$/);
});

test('localDate 按本地日历偏移，不经过 UTC', () => {
  const today = localDate(0);
  const yesterday = localDate(-1);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Date.parse(`${today}T00:00:00`) - Date.parse(`${yesterday}T00:00:00`), 86_400_000);
});
