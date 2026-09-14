const test = require('node:test');
const assert = require('node:assert/strict');
const { createState } = require('../../src/domain/state-schema');

let domain = {};
try {
  domain = require('../../src/domain/daily-todo-engine');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const NOW = '2026-09-13T10:30:00.000+08:00';

function createEngine(state = createState('2026-09-13'), now = () => NOW) {
  const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
  return domain.createDailyTodoEngine(state, {
    now,
    createId: () => ids.shift()
  });
}

test('task commands trim text, append at the bottom and update only Today', () => {
  assert.equal(typeof domain.createDailyTodoEngine, 'function');
  const engine = createEngine();

  assert.equal(engine.addTask('  第一件事  ').ok, true);
  assert.equal(engine.addTask('第二件事').ok, true);
  assert.equal(engine.addTask('   ').ok, false);

  let snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.activeDay.tasks.map((task) => task.text), ['第一件事', '第二件事']);
  assert.equal(snapshot.activeDay.tasks[0].createdAt, NOW);

  assert.equal(engine.editTask('id-1', '修改后').ok, true);
  assert.equal(engine.toggleTask('id-1').ok, true);
  assert.equal(engine.reorderTask('id-1', 1).ok, true);

  snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.activeDay.tasks.map((task) => task.text), ['第二件事', '修改后']);
  assert.equal(snapshot.activeDay.tasks[1].completed, true);
  assert.equal(snapshot.activeDay.tasks[1].completedAt, NOW);
});

test('snapshots cannot mutate the engine state', () => {
  const engine = createEngine();
  engine.addTask('可信状态');

  const outside = engine.getSnapshot();
  outside.activeDay.tasks[0].text = '外部篡改';

  assert.equal(engine.getSnapshot().activeDay.tasks[0].text, '可信状态');
});

test('delete returns a one-use token and undo restores the original index', () => {
  const engine = createEngine();
  engine.addTask('A');
  engine.addTask('B');

  const deletion = engine.deleteTodayTask('id-1');
  assert.equal(deletion.ok, true);
  assert.deepEqual(engine.getSnapshot().activeDay.tasks.map((task) => task.text), ['B']);

  assert.equal(engine.undo(deletion.undoToken).ok, true);
  assert.deepEqual(engine.getSnapshot().activeDay.tasks.map((task) => task.text), ['A', 'B']);
  assert.equal(engine.undo(deletion.undoToken).ok, false);
});

test('a new deletion replaces the previous undo record', () => {
  const engine = createEngine();
  engine.addTask('A');
  engine.addTask('B');

  const firstDeletion = engine.deleteTodayTask('id-1');
  const secondDeletion = engine.deleteTodayTask('id-2');

  assert.equal(engine.undo(firstDeletion.undoToken).ok, false);
  assert.equal(engine.undo(secondDeletion.undoToken).ok, true);
  assert.deepEqual(engine.getSnapshot().activeDay.tasks.map((task) => task.text), ['B']);
});

test('undo is accepted through six seconds and rejected immediately after', async (context) => {
  const cases = [
    ['before boundary', 5999, true],
    ['at boundary', 6000, true],
    ['after boundary', 6001, false]
  ];

  for (const [name, elapsedMilliseconds, expected] of cases) {
    await context.test(name, () => {
      let current = NOW;
      const engine = createEngine(createState('2026-09-13'), () => current);
      engine.addTask('限时撤销');
      const deletion = engine.deleteTodayTask('id-1');
      current = new Date(Date.parse(NOW) + elapsedMilliseconds).toISOString();

      assert.equal(engine.undo(deletion.undoToken).ok, expected);
    });
  }
});

test('history is read-only but supports delete and undo', () => {
  const state = createState('2026-09-13');
  state.history.push({
    date: '2026-09-12',
    closedAt: '2026-09-13T00:00:00.000+08:00',
    tasks: [task('history-1', '昨天', false, '2026-09-12T10:00:00.000+08:00')]
  });
  const engine = createEngine(state);

  assert.equal(engine.editTask('history-1', '不能修改').ok, false);
  assert.match(engine.editTask('history-1', '不能修改').error, /只读/);

  const deletion = engine.deleteHistoryTask('2026-09-12', 'history-1');
  assert.equal(deletion.ok, true);
  assert.equal(engine.getSnapshot().history[0].tasks.length, 0);
  assert.equal(engine.undo(deletion.undoToken).ok, true);
  assert.equal(engine.getSnapshot().history[0].tasks[0].text, '昨天');
});

test('moving to a later local date archives Today without carrying tasks', () => {
  const engine = createEngine();
  engine.addTask('不会自动续期');

  const result = engine.ensureCurrentDay('2026-09-14T00:00:01.000+08:00');
  const snapshot = engine.getSnapshot();

  assert.equal(result.rolledOver, true);
  assert.equal(snapshot.activeDay.date, '2026-09-14');
  assert.deepEqual(snapshot.activeDay.tasks, []);
  assert.equal(snapshot.history[0].date, '2026-09-13');
  assert.equal(snapshot.history[0].tasks[0].text, '不会自动续期');
});

test('clock rollback keeps the current day and returns a warning', () => {
  const engine = createEngine();

  const result = engine.ensureCurrentDay('2026-09-12T23:59:59.000+08:00');

  assert.equal(result.clockMovedBackward, true);
  assert.match(result.warning, /系统日期/);
  assert.equal(engine.getSnapshot().activeDay.date, '2026-09-13');
});

test('an unfinished historical task can continue to Today only once', () => {
  const state = createState('2026-09-13');
  state.history.push({
    date: '2026-09-12',
    closedAt: '2026-09-13T00:00:00.000+08:00',
    tasks: [task('history-1', '继续学习', false, '2026-09-12T10:00:00.000+08:00')]
  });
  const engine = createEngine(state);

  assert.equal(engine.continueTask('2026-09-12', 'history-1').ok, true);
  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.activeDay.tasks[0].text, '继续学习');
  assert.equal(snapshot.activeDay.tasks[0].continuedFromTaskId, 'history-1');
  assert.equal(snapshot.history[0].tasks[0].continuedToTaskId, 'id-1');
  assert.equal(snapshot.history[0].tasks[0].hasBeenContinued, true);

  const deletion = engine.deleteTodayTask('id-1');
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.history[0].tasks[0].continuedToTaskId, null);
  assert.equal(engine.continueTask('2026-09-12', 'history-1').ok, false);

  assert.equal(engine.undo(deletion.undoToken).ok, true);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.history[0].tasks[0].continuedToTaskId, 'id-1');
  assert.equal(snapshot.activeDay.tasks[0].continuedFromTaskId, 'history-1');
});

test('replacing an undo record cannot leave dangling continuation links', () => {
  const state = createState('2026-09-13');
  state.history.push({
    date: '2026-09-12',
    closedAt: '2026-09-13T00:00:00.000+08:00',
    tasks: [task('history-1', '关系完整', false, '2026-09-12T10:00:00.000+08:00')]
  });
  const engine = createEngine(state);
  engine.continueTask('2026-09-12', 'history-1');
  const targetDeletion = engine.deleteTodayTask('id-1');
  const sourceDeletion = engine.deleteHistoryTask('2026-09-12', 'history-1');

  assert.equal(engine.undo(targetDeletion.undoToken).ok, false);
  assert.equal(engine.getSnapshot().activeDay.tasks.length, 0);

  assert.equal(engine.undo(sourceDeletion.undoToken).ok, true);
  assert.equal(engine.undo(targetDeletion.undoToken).ok, false);
  assert.equal(require('../../src/domain/state-schema').validateState(engine.getSnapshot()).ok, true);
});

test('rollover rejects malformed ISO instants before changing state', () => {
  const engine = createEngine();
  engine.addTask('不能丢失');

  const result = engine.ensureCurrentDay('2026-99-99Tgarbage');

  assert.equal(result.ok, false);
  assert.equal(engine.getSnapshot().activeDay.date, '2026-09-13');
  assert.equal(engine.getSnapshot().history.length, 0);
});

test('completed or missing historical tasks cannot continue', () => {
  const state = createState('2026-09-13');
  state.history.push({
    date: '2026-09-12',
    closedAt: '2026-09-13T00:00:00.000+08:00',
    tasks: [{ ...task('done', '完成项', true, '2026-09-12T10:00:00.000+08:00'), completedAt: NOW }]
  });
  const engine = createEngine(state);

  assert.equal(engine.continueTask('2026-09-12', 'done').ok, false);
  assert.equal(engine.continueTask('2026-09-12', 'missing').ok, false);
  assert.equal(engine.continueTask('2026-09-11', 'missing').ok, false);
});

test('settings and window bounds update only through validated engine commands', () => {
  const engine = createEngine();

  // backgroundOpacity 与 windowMode 是历史字段：界面和 IPC 都不再改它们，
  // 但引擎仍然接受，老存档和手工补丁不会因为这两个键被拒。
  assert.equal(engine.updateSettings({ backgroundOpacity: 0.75 }).ok, true);
  assert.equal(engine.updateSettings({ windowMode: 'desktop', closeToTray: false }).ok, true);
  assert.equal(engine.updateWindowBounds({ x: 120, y: 80, width: 420, height: 640 }).ok, true);
  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.settings.backgroundOpacity, 0.75);
  assert.equal(snapshot.settings.windowMode, 'desktop');
  assert.equal(snapshot.settings.closeToTray, false);
  assert.deepEqual(snapshot.windowBounds, { x: 120, y: 80, width: 420, height: 640 });

  assert.equal(engine.updateSettings({ backgroundOpacity: 0.2 }).ok, false);
  assert.equal(engine.updateSettings({ unexpected: true }).ok, false);
  assert.equal(engine.updateWindowBounds({ width: 10 }).ok, false);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.settings.backgroundOpacity, 0.75);
  assert.equal(snapshot.windowBounds.width, 420);
});

test('replaceState validates imports and clears obsolete undo records', () => {
  const engine = createEngine();
  const deletion = engine.addTask('即将被替换').snapshot.activeDay.tasks[0];
  const deleted = engine.deleteTodayTask(deletion.id);
  const imported = createState('2026-09-14');
  imported.settings.backgroundOpacity = 0.7;

  assert.equal(engine.replaceState(imported).ok, true);
  assert.equal(engine.getSnapshot().activeDay.date, '2026-09-14');
  assert.equal(engine.undo(deleted.undoToken).ok, false);

  const beforeInvalid = engine.getSnapshot();
  assert.equal(engine.replaceState({ schemaVersion: 999 }).ok, false);
  assert.deepEqual(engine.getSnapshot(), beforeInvalid);
});

function task(id, text, completed, createdAt) {
  return {
    id,
    text,
    completed,
    createdAt,
    completedAt: null,
    continuedFromTaskId: null,
    continuedFromDate: null,
    continuedToTaskId: null,
    continuedToDate: null,
    hasBeenContinued: false
  };
}
