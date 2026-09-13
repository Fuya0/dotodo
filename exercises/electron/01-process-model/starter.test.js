const test = require('node:test');
const assert = require('node:assert/strict');
const { clamp, normalizeTaskText, moveItem, createSequence, rollover } = require('./starter');

test('clamp limits values to the requested interval', () => {
  assert.equal(clamp(40, 55, 100), 55);
  assert.equal(clamp(72, 55, 100), 72);
  assert.equal(clamp(120, 55, 100), 100);
});

test('normalizeTaskText trims and validates task text', () => {
  assert.deepEqual(normalizeTaskText('  学 Electron  '), { ok: true, text: '学 Electron' });
  assert.deepEqual(normalizeTaskText('   '), { ok: false });
  assert.deepEqual(normalizeTaskText(42), { ok: false });
  assert.deepEqual(normalizeTaskText('123456789012345678901'), { ok: false });
});

test('moveItem returns a reordered copy without changing the input', () => {
  const original = ['A', 'B', 'C'];
  assert.deepEqual(moveItem(original, 0, 2), ['B', 'C', 'A']);
  assert.deepEqual(original, ['A', 'B', 'C']);
  assert.notEqual(moveItem(original, -1, 2), original);
  assert.deepEqual(moveItem(original, -1, 2), original);
});

test('createSequence keeps private progress in a closure', () => {
  const next = createSequence(['first', 'second']);
  assert.equal(next(), 'first');
  assert.equal(next(), 'second');
  assert.throws(() => next(), /用完|耗尽/);
});

test('rollover archives the old day and does not carry its tasks', () => {
  const state = {
    activeDay: { date: '2026-09-13', tasks: [{ id: '1' }] },
    history: [{ date: '2026-09-12', tasks: [] }]
  };
  const next = rollover(state, '2026-09-14');
  assert.equal(next.activeDay.date, '2026-09-14');
  assert.deepEqual(next.activeDay.tasks, []);
  assert.equal(next.history[0].date, '2026-09-13');
  assert.deepEqual(state.history, [{ date: '2026-09-12', tasks: [] }]);
  assert.throws(() => rollover(state, '2026-09-11'), /回退/);
});
