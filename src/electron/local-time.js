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

module.exports = { formatLocalInstant };
