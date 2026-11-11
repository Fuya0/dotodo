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

test('millisecondsUntilNextMidnight 给出到下一个本地零点的毫秒数', () => {
  const now = new Date(2026, 8, 14, 23, 0, 0, 0); // 本地时间 23:00
  assert.equal(timeModule.millisecondsUntilNextMidnight(now), 3_600_000);
});

test('millisecondsUntilNextMidnight 在零点整给出整整一天，而不是 0', () => {
  // 正好站在零点上时，"下一个零点"是明天，不是"现在"——否则定时器会立刻空转。
  const midnight = new Date(2026, 8, 15, 0, 0, 0, 0);
  const delay = timeModule.millisecondsUntilNextMidnight(midnight);
  assert.ok(delay > 23 * 3_600_000, `延迟太短：${delay}`);
  assert.ok(delay <= 86_400_000, `延迟超过一天：${delay}`);
});

test('millisecondsUntilNextMidnight 拒绝无效日期', () => {
  assert.throws(() => timeModule.millisecondsUntilNextMidnight(new Date('nope')), TypeError);
  assert.throws(() => timeModule.millisecondsUntilNextMidnight('2026-09-14'), TypeError);
});
