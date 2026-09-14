const test = require('node:test');
const assert = require('node:assert/strict');

let schema = {};
try {
  schema = require('../../src/domain/state-schema');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('createState creates an open local day with desktop defaults', () => {
  assert.equal(typeof schema.createState, 'function');

  const state = schema.createState('2026-09-13', '2026-09-13T08:00:00.000+08:00');

  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.activeDay, {
    date: '2026-09-13',
    closedAt: null,
    tasks: []
  });
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.settings, {
    backgroundOpacity: 0.82,
    windowMode: 'desktop',
    closeToTray: true,
    launchAtLogin: false
  });
  assert.deepEqual(state.windowBounds, { width: 390, height: 610 });
});

test('cloneState prevents callers from mutating trusted state', () => {
  assert.equal(typeof schema.cloneState, 'function');
  const original = {
    schemaVersion: 1,
    activeDay: { date: '2026-09-13', closedAt: null, tasks: [] },
    history: [],
    settings: { backgroundOpacity: 0.82 },
    windowBounds: { width: 390, height: 610 }
  };

  const clone = schema.cloneState(original);
  clone.activeDay.tasks.push({ id: 'outside' });

  assert.notEqual(clone, original);
  assert.notEqual(clone.activeDay, original.activeDay);
  assert.deepEqual(original.activeDay.tasks, []);
});

test('validateState rejects malformed dates and duplicate task ids', () => {
  assert.equal(typeof schema.validateState, 'function');
  const state = {
    schemaVersion: 1,
    activeDay: {
      date: '09/13/2026',
      closedAt: null,
      tasks: [
        { id: 'same', text: 'A', completed: false, createdAt: '2026-09-13T08:00:00Z' },
        { id: 'same', text: 'B', completed: false, createdAt: '2026-09-13T09:00:00Z' }
      ]
    },
    history: [],
    settings: {
      backgroundOpacity: 0.82,
      windowMode: 'desktop',
      closeToTray: true,
      launchAtLogin: false
    },
    windowBounds: { width: 390, height: 610 }
  };

  const result = schema.validateState(state);

  assert.equal(result.ok, false);
  assert.match(result.error, /日期|任务 ID/);
});

test('validateState accepts a complete state with reciprocal continuation links', () => {
  const state = validLinkedState();

  const result = schema.validateState(state);

  assert.equal(result.ok, true);
  assert.notEqual(result.state, state);
  assert.deepEqual(result.state, state);
});

test('validateState rejects inconsistent tasks, settings, history and continuation links', async (context) => {
  const cases = [
    ['completion mismatch', (state) => { state.activeDay.tasks[0].completed = true; }],
    ['missing completion time field', (state) => { delete state.activeDay.tasks[0].completedAt; }],
    ['undefined completion time', (state) => { state.activeDay.tasks[0].completedAt = undefined; }],
    ['wrong completion time type', (state) => { state.activeDay.tasks[0].completedAt = false; }],
    ['non ISO created time', (state) => { state.activeDay.tasks[0].createdAt = 'March 1 2026'; }],
    ['completion before creation', (state) => {
      state.activeDay.tasks[0].completed = true;
      state.activeDay.tasks[0].completedAt = '2026-09-12T08:00:00.000+08:00';
    }],
    ['blank text', (state) => { state.activeDay.tasks[0].text = '  '; }],
    ['bad opacity', (state) => { state.settings.backgroundOpacity = 0.2; }],
    ['unknown window mode', (state) => { state.settings.windowMode = 'ceiling'; }],
    ['open history day', (state) => { state.history[0].closedAt = null; }],
    ['history after Today', (state) => { state.history[0].date = '2026-09-14'; }],
    ['dangling continuation', (state) => { state.history[0].tasks[0].continuedToTaskId = 'missing'; }],
    ['non reciprocal continuation', (state) => {
      state.activeDay.tasks[0].continuedFromTaskId = null;
      state.activeDay.tasks[0].continuedFromDate = null;
    }]
  ];

  for (const [name, mutate] of cases) {
    await context.test(name, () => {
      const state = validLinkedState();
      mutate(state);
      assert.equal(schema.validateState(state).ok, false);
    });
  }
});

function validLinkedState() {
  return {
    schemaVersion: 1,
    activeDay: {
      date: '2026-09-13',
      closedAt: null,
      tasks: [{
        id: 'today-1',
        text: '今天继续',
        completed: false,
        createdAt: '2026-09-13T08:00:00.000+08:00',
        completedAt: null,
        continuedFromTaskId: 'history-1',
        continuedFromDate: '2026-09-12',
        continuedToTaskId: null,
        continuedToDate: null,
        hasBeenContinued: false
      }]
    },
    history: [{
      date: '2026-09-12',
      closedAt: '2026-09-13T00:00:00.000+08:00',
      tasks: [{
        id: 'history-1',
        text: '昨天来源',
        completed: false,
        createdAt: '2026-09-12T08:00:00.000+08:00',
        completedAt: null,
        continuedFromTaskId: null,
        continuedFromDate: null,
        continuedToTaskId: 'today-1',
        continuedToDate: '2026-09-13',
        hasBeenContinued: true
      }]
    }],
    settings: {
      backgroundOpacity: 0.82,
      windowMode: 'desktop',
      closeToTray: true,
      launchAtLogin: false
    },
    windowBounds: { width: 390, height: 610 }
  };
}
