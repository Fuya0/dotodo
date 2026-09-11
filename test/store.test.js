const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState } = require('../src/store');

test('normalizeState keeps valid todos and clamps settings', () => {
  const state = normalizeState({
    todos: [{ id: '1', text: '  Ship it  ', completed: 1, createdAt: 10 }, { text: '   ' }],
    opacity: 0.1,
    alwaysOnTop: false,
    windowBounds: { width: 100, height: 2000 }
  });
  assert.deepEqual(state.todos, [{ id: '1', text: 'Ship it', completed: true, createdAt: 10 }]);
  assert.equal(state.opacity, 0.55);
  assert.equal(state.alwaysOnTop, false);
  assert.equal(state.windowBounds.width, 330);
  assert.equal(state.windowBounds.height, 900);
});

test('normalizeState restores safe defaults for malformed input', () => {
  const state = normalizeState({ todos: 'nope', opacity: 'nope' });
  assert.deepEqual(state.todos, []);
  assert.equal(state.opacity, 0.94);
  assert.equal(state.alwaysOnTop, true);
});
