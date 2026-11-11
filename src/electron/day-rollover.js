const DEFAULT_CALIBRATION_INTERVAL = 15 * 60 * 1000;

function createDayRolloverScheduler({
  onCheck,
  getNow = () => new Date(),
  millisecondsUntilNextMidnight,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  powerMonitor = null,
  calibrationInterval = DEFAULT_CALIBRATION_INTERVAL
}) {
  if (typeof onCheck !== 'function') throw new TypeError('onCheck 必须是函数。');
  if (typeof millisecondsUntilNextMidnight !== 'function') {
    throw new TypeError('millisecondsUntilNextMidnight 必须是函数。');
  }

  let midnightTimer = null;
  let calibrationTimer = null;
  let started = false;

  const check = () => {
    if (started) onCheck();
  };

  const scheduleMidnight = () => {
    if (!started) return;
    if (midnightTimer !== null) clearTimeoutFn(midnightTimer);
    midnightTimer = setTimeoutFn(() => {
      midnightTimer = null;
      check();
      scheduleMidnight();
    }, millisecondsUntilNextMidnight(getNow()));
    if (typeof midnightTimer.unref === 'function') midnightTimer.unref();
  };

  const recheck = () => {
    check();
    scheduleMidnight();
  };

  const start = () => {
    if (started) return;
    started = true;
    calibrationTimer = setIntervalFn(recheck, calibrationInterval);
    if (typeof calibrationTimer.unref === 'function') calibrationTimer.unref();
    if (powerMonitor && typeof powerMonitor.on === 'function') powerMonitor.on('resume', recheck);
    scheduleMidnight();
  };

  const stop = () => {
    if (!started) return;
    started = false;
    if (midnightTimer !== null) clearTimeoutFn(midnightTimer);
    if (calibrationTimer !== null) clearIntervalFn(calibrationTimer);
    midnightTimer = null;
    calibrationTimer = null;
    if (powerMonitor && typeof powerMonitor.removeListener === 'function') {
      powerMonitor.removeListener('resume', recheck);
    }
  };

  return Object.freeze({ start, stop });
}

module.exports = { createDayRolloverScheduler, DEFAULT_CALIBRATION_INTERVAL };
