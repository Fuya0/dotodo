function formatLocalInstant(date = new Date(), timezoneOffsetMinutes = date.getTimezoneOffset()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('日期必须是有效的 Date。');
  }
  if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
    throw new TypeError('时区偏移必须是 -840 到 840 之间的整数分钟。');
  }

  const localTime = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  const localFields = localTime.toISOString().slice(0, -1);
  const sign = timezoneOffsetMinutes <= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(timezoneOffsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const minutes = String(absoluteOffset % 60).padStart(2, '0');
  return `${localFields}${sign}${hours}:${minutes}`;
}

/**
 * 距离下一个本地零点还有多少毫秒。
 *
 * 应用可能整天开着，而"今天"只在启动和每条命令前才会被校正一次。跨过午夜之后
 * 界面还停在昨天：用户点一下昨天那条任务时，主进程会先归档，那条任务已经不在
 * 今天了，于是返回「任务不存在」——数据没错，但用户每天被莫名报错一次。
 *
 * 所以需要一个到点就翻页的定时器。这里只算延迟，真正调度在 main.js。
 *
 * @param {Date} now 当前时间。
 * @returns {number} 到下一个本地零点的毫秒数，包含夏令时切换日的 23/25 小时间隔。
 */
function millisecondsUntilNextMidnight(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('日期必须是有效的 Date。');
  }

  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();

  // 保留本地日历的真实间隔：DST 切换日可能是 23 或 25 小时。
  if (!Number.isFinite(delay) || delay <= 0) return 1;
  return delay;
}

module.exports = { formatLocalInstant, millisecondsUntilNextMidnight };
