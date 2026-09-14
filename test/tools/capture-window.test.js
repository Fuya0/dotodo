const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDemoState, earlierToday, localDate, instant } = require('../../tools/capture-window');
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

test('今天任务的时刻由「现在」推出来，任何钟点跑都不会落到未来', () => {
  // 这条是踩出来的。以前 createdAt 写死在当天 08:00、completedAt 写死在 10:30，
  // 凌晨跑验收时两个都还在未来：用户点一下「完成」，写进去的"现在"反而早于创建时间，
  // 整份状态被 schema 拒掉，界面上弹出「数据暂时只保存在内存中」—— 而他什么都没做错。
  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  for (const progress of [0, 0.1, 0.5, 0.74, 0.99, 1]) {
    const at = Date.parse(earlierToday(progress));
    assert.ok(Number.isFinite(at), `progress=${progress} 解析不了`);
    assert.ok(at >= midnight.getTime(), `progress=${progress} 早于今天零点`);
    assert.ok(at <= now + 1_000, `progress=${progress} 落到了未来`);
  }
});

test('演示数据里没有任何时刻落在未来', () => {
  const state = buildDemoState();
  const instants = [...state.activeDay.tasks, ...state.history.flatMap((day) => day.tasks)]
    .flatMap((task) => [task.createdAt, task.completedAt])
    .filter((value) => value !== null);

  assert.ok(instants.length >= 12, `演示数据里的时刻太少：${instants.length}`);
  // 留一分钟余量：跑断言本身也要花时间。
  const limit = Date.now() + 60_000;
  const stragglers = instants.filter((value) => !(Date.parse(value) <= limit));
  assert.deepEqual(stragglers, [], `这些时刻落在未来或者解析不了：${stragglers.join(', ')}`);
});
