const DEFAULT_SETTINGS = Object.freeze({
  // 遗留字段：背景透明度现在是固定的视觉常量（见 src/renderer/styles.css），
  // 界面和 IPC 都不再暴露它。保留是为了让老存档照常通过校验，不需要升级 schemaVersion。
  backgroundOpacity: 0.82,
  windowMode: 'topmost',
  closeToTray: true,
  launchAtLogin: false
});

const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 390, height: 610 });
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function createState(localDate) {
  if (!isLocalDate(localDate)) {
    throw new TypeError('localDate 必须使用 yyyy-MM-dd 格式。');
  }

  return {
    schemaVersion: 1,
    activeDay: {
      date: localDate,
      closedAt: null,
      tasks: []
    },
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    windowBounds: { ...DEFAULT_WINDOW_BOUNDS }
  };
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateState(value) {
  if (!value || typeof value !== 'object') {
    return invalid('状态必须是对象。');
  }

  if (value.schemaVersion !== 1) {
    return invalid('状态版本不受支持。');
  }

  if (!value.activeDay || !Array.isArray(value.history)) return invalid('状态缺少日期记录。');
  if (value.activeDay.closedAt !== null) return invalid('当前日期不能处于归档状态。');
  const taskIds = new Set();
  const dates = new Set();
  const tasksByLocation = new Map();
  const days = [value.activeDay, ...value.history];
  for (const [dayIndex, day] of days.entries()) {
    if (!day || !isLocalDate(day.date) || dates.has(day.date) || !Array.isArray(day.tasks)) {
      return invalid('日期记录无效。');
    }
    dates.add(day.date);
    if (dayIndex > 0 && !isInstant(day.closedAt)) return invalid('历史日期缺少有效归档时间。');
    if (dayIndex > 0 && day.date >= days[dayIndex - 1].date) {
      return invalid('历史日期必须早于当前日期并按倒序排列。');
    }

    for (const task of day.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || taskIds.has(task.id)) {
        return invalid('任务 ID 无效或重复。');
      }
      taskIds.add(task.id);
      const taskError = validateTask(task, day.date);
      if (taskError) return invalid(taskError);
      tasksByLocation.set(taskKey(day.date, task.id), task);
    }
  }

  for (const day of days) {
    for (const task of day.tasks) {
      const linkError = validateLinks(task, day.date, tasksByLocation);
      if (linkError) return invalid(linkError);
    }
  }

  const settings = value.settings;
  if (!settings || !Number.isFinite(settings.backgroundOpacity) ||
      settings.backgroundOpacity < 0.55 || settings.backgroundOpacity > 1 ||
      !['normal', 'topmost', 'desktop'].includes(settings.windowMode) ||
      typeof settings.closeToTray !== 'boolean' || typeof settings.launchAtLogin !== 'boolean') {
    return invalid('设置值无效。');
  }

  const bounds = value.windowBounds;
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
      bounds.width < 330 || bounds.width > 720 || bounds.height < 420 || bounds.height > 900 ||
      (bounds.x !== undefined && !Number.isFinite(bounds.x)) ||
      (bounds.y !== undefined && !Number.isFinite(bounds.y))) {
    return invalid('窗口位置或尺寸无效。');
  }

  return { ok: true, state: cloneState(value) };
}

function validateTask(task, ownDate) {
  if (typeof task.text !== 'string' || !task.text || task.text !== task.text.trim() ||
      task.text.length > 240) return '任务文本无效。';
  if (typeof task.completed !== 'boolean' || !isInstant(task.createdAt)) return '任务状态无效。';
  if ((!task.completed && task.completedAt !== null) || (task.completed && !isInstant(task.completedAt))) {
    return '任务完成状态与时间不一致。';
  }
  if (task.completed && parseIsoInstant(task.completedAt) < parseIsoInstant(task.createdAt)) {
    return '任务完成时间不能早于创建时间。';
  }
  if (typeof task.hasBeenContinued !== 'boolean') return '任务延续状态无效。';

  const hasFromId = typeof task.continuedFromTaskId === 'string' && task.continuedFromTaskId.length > 0;
  const hasFromDate = isLocalDate(task.continuedFromDate);
  const hasToId = typeof task.continuedToTaskId === 'string' && task.continuedToTaskId.length > 0;
  const hasToDate = isLocalDate(task.continuedToDate);
  const fromEmpty = task.continuedFromTaskId === null && task.continuedFromDate === null;
  const toEmpty = task.continuedToTaskId === null && task.continuedToDate === null;
  if ((!fromEmpty && !(hasFromId && hasFromDate)) || (!toEmpty && !(hasToId && hasToDate))) {
    return '任务延续 ID 与日期必须成对出现。';
  }
  if (hasFromDate && task.continuedFromDate >= ownDate) return '任务延续来源日期无效。';
  if (hasToDate && task.continuedToDate <= ownDate) return '任务延续目标日期无效。';
  if (hasToId && !task.hasBeenContinued) return '任务延续事实与目标不一致。';
  return null;
}

function validateLinks(task, ownDate, tasksByLocation) {
  if (task.continuedFromTaskId) {
    const source = tasksByLocation.get(taskKey(task.continuedFromDate, task.continuedFromTaskId));
    if (!source || source.continuedToTaskId !== task.id || source.continuedToDate !== ownDate) {
      return '任务延续来源不存在或双向链接不一致。';
    }
  }
  if (task.continuedToTaskId) {
    const target = tasksByLocation.get(taskKey(task.continuedToDate, task.continuedToTaskId));
    if (!target || target.continuedFromTaskId !== task.id || target.continuedFromDate !== ownDate) {
      return '任务延续目标不存在或双向链接不一致。';
    }
  }
  return null;
}

function taskKey(date, id) {
  return `${date}|${id}`;
}

function isInstant(value) {
  return parseIsoInstant(value) !== null;
}

function parseIsoInstant(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(ISO_INSTANT_PATTERN);
  if (!match || !isLocalDate(match[1])) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function localDateOf(value) {
  if (parseIsoInstant(value) === null) return null;
  return value.slice(0, 10);
}

function isLocalDate(value) {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function invalid(error) {
  return { ok: false, error };
}

module.exports = {
  cloneState,
  createState,
  localDateOf,
  parseIsoInstant,
  validateState
};
