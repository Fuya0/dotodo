const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDayRolloverScheduler } = require('../../src/electron/day-rollover');

function createClock() {
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    timeouts,
    intervals,
    setTimeout(fn, delay) {
      const timer = { id: ++nextId, fn, delay };
      timeouts.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) { timeouts.delete(timer.id); },
    setInterval(fn, delay) {
      const timer = { id: ++nextId, fn, delay };
      intervals.set(timer.id, timer);
      return timer;
    },
    clearInterval(timer) { intervals.delete(timer.id); },
    fireTimeout() {
      const timer = timeouts.values().next().value;
      assert.ok(timer);
      timeouts.delete(timer.id);
      timer.fn();
    }
  };
}

test('scheduler performs a bounded periodic check and recalculates the midnight timer', () => {
  const clock = createClock();
  let checks = 0;
  const scheduler = createDayRolloverScheduler({
    onCheck: () => { checks += 1; },
    getNow: () => new Date(2026, 8, 14, 23, 0),
    millisecondsUntilNextMidnight: () => 60_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval,
    calibrationInterval: 900_000
  });

  scheduler.start();
  assert.equal(clock.intervals.values().next().value.delay, 900_000);
  clock.intervals.values().next().value.fn();
  assert.equal(checks, 1);
  clock.fireTimeout();
  assert.equal(checks, 2);
  assert.equal(clock.timeouts.values().next().value.delay, 60_000);
  scheduler.stop();
  assert.equal(clock.timeouts.size, 0);
  assert.equal(clock.intervals.size, 0);
});

test('scheduler uses the full DST day delay instead of clamping it to 24 hours', () => {
  const clock = createClock();
  const scheduler = createDayRolloverScheduler({
    onCheck: () => {},
    getNow: () => new Date(2026, 10, 1, 0, 0),
    millisecondsUntilNextMidnight: () => 25 * 3_600_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval
  });

  scheduler.start();
  assert.equal(clock.timeouts.values().next().value.delay, 25 * 3_600_000);
  scheduler.stop();
});

test('scheduler checks immediately on resume and removes the resume listener on stop', () => {
  const clock = createClock();
  const monitor = new EventEmitter();
  let checks = 0;
  const scheduler = createDayRolloverScheduler({
    onCheck: () => { checks += 1; },
    millisecondsUntilNextMidnight: () => 1_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval,
    powerMonitor: monitor
  });

  scheduler.start();
  monitor.emit('resume');
  assert.equal(checks, 1);
  scheduler.stop();
  monitor.emit('resume');
  assert.equal(checks, 1);
});
