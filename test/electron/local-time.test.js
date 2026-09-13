const test = require('node:test');
const assert = require('node:assert/strict');

let timeModule = {};
try {
  timeModule = require('../../src/electron/local-time');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('formatLocalInstant keeps the local calendar date and explicit offset', () => {
  assert.equal(typeof timeModule.formatLocalInstant, 'function');
  const instant = new Date('2026-09-12T16:30:45.123Z');

  assert.equal(
    timeModule.formatLocalInstant(instant, -480),
    '2026-09-13T00:30:45.123+08:00'
  );
  assert.equal(
    timeModule.formatLocalInstant(instant, 300),
    '2026-09-12T11:30:45.123-05:00'
  );
});

test('formatLocalInstant rejects invalid dates and offsets', () => {
  assert.throws(() => timeModule.formatLocalInstant(new Date('bad'), 0), /日期/);
  assert.throws(() => timeModule.formatLocalInstant(new Date(), 901), /时区/);
  assert.throws(() => timeModule.formatLocalInstant(new Date(), 1.5), /时区/);
});
