const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  makeStatePaths,
  safeParseJson,
  classifyCandidate,
  chooseLoadResult,
  serializeState
} = require('./starter');

test('makeStatePaths returns platform-safe absolute paths', () => {
  const paths = makeStatePaths(path.join('.', 'practice-data'));
  assert.equal(path.isAbsolute(paths.primary), true);
  assert.equal(paths.primary, path.resolve('practice-data', 'state.json'));
  assert.equal(paths.backup, path.resolve('practice-data', 'state.backup.json'));
  assert.equal(paths.temporary, path.resolve('practice-data', 'state.tmp.json'));
});

test('safeParseJson returns a result instead of throwing', () => {
  assert.deepEqual(safeParseJson('{"done":true}'), { ok: true, value: { done: true } });
  const failure = safeParseJson('{broken');
  assert.equal(failure.ok, false);
  assert.equal(failure.error instanceof Error, true);
});

test('classifyCandidate distinguishes missing, corrupt and valid input', () => {
  const validate = (value) => ({ ok: value.version === 1 });
  assert.deepEqual(classifyCandidate(null, validate), { kind: 'missing' });
  assert.equal(classifyCandidate('{oops', validate).kind, 'corrupt');
  assert.equal(classifyCandidate('{"version":2}', validate).kind, 'corrupt');
  assert.deepEqual(classifyCandidate('{"version":1}', validate), {
    kind: 'valid',
    value: { version: 1 }
  });
});

test('chooseLoadResult prefers primary, then backup, then empty', () => {
  const primary = { kind: 'valid', value: { name: 'primary' } };
  const backup = { kind: 'valid', value: { name: 'backup' } };
  assert.deepEqual(chooseLoadResult(primary, backup), {
    state: { name: 'primary' }, source: 'primary'
  });
  assert.deepEqual(chooseLoadResult({ kind: 'corrupt' }, backup), {
    state: { name: 'backup' }, source: 'backup'
  });
  assert.deepEqual(chooseLoadResult({ kind: 'missing' }, { kind: 'corrupt' }), {
    state: null, source: 'empty'
  });
});

test('serializeState creates readable JSON without changing input', () => {
  const state = { activeDay: { tasks: [] } };
  const text = serializeState(state);
  assert.equal(text, '{\n  "activeDay": {\n    "tasks": []\n  }\n}\n');
  assert.deepEqual(state, { activeDay: { tasks: [] } });
});
