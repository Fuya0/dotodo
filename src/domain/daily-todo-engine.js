const { cloneState, localDateOf, parseIsoInstant, validateState } = require('./state-schema');

const MAX_TEXT_LENGTH = 240;

function createDailyTodoEngine(initialState, dependencies) {
  if (!initialState || !dependencies || typeof dependencies.now !== 'function' ||
      typeof dependencies.createId !== 'function') {
    throw new TypeError('领域引擎需要初始状态、时钟和 ID 生成器。');
  }

  let state = cloneState(initialState);
  let undoRecord = null;

  function getSnapshot() {
    return cloneState(state);
  }

  function success(extra = {}) {
    return { ok: true, snapshot: getSnapshot(), ...extra };
  }

  function failure(error) {
    return { ok: false, error, snapshot: getSnapshot() };
  }

  function addTask(text) {
    const normalized = normalizeText(text);
    if (!normalized.ok) return failure(normalized.error);

    const id = dependencies.createId();
    if (findTaskById(id)) return failure('生成的任务 ID 已存在。');
    state.activeDay.tasks.push(createTask(id, normalized.text, dependencies.now()));
    return success();
  }

  function editTask(id, text) {
    const task = findTodayTask(id);
    if (!task) return unavailableTask(id);
    const normalized = normalizeText(text);
    if (!normalized.ok) return failure(normalized.error);
    task.text = normalized.text;
    return success();
  }

  function toggleTask(id) {
    const task = findTodayTask(id);
    if (!task) return unavailableTask(id);
    task.completed = !task.completed;
    task.completedAt = task.completed ? dependencies.now() : null;
    return success();
  }

  function reorderTask(id, targetIndex) {
    const tasks = state.activeDay.tasks;
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= tasks.length) {
      return failure('目标位置超出任务列表范围。');
    }
    const currentIndex = tasks.findIndex((task) => task.id === id);
    if (currentIndex < 0) return unavailableTask(id);
    const [task] = tasks.splice(currentIndex, 1);
    tasks.splice(targetIndex, 0, task);
    return success();
  }

  function deleteTodayTask(id) {
    return deleteFromDay(state.activeDay, id);
  }

  function deleteHistoryTask(date, id) {
    const day = state.history.find((item) => item.date === date);
    if (!day) return failure('找不到该历史日期。');
    return deleteFromDay(day, id);
  }

  function deleteFromDay(day, id) {
    const index = day.tasks.findIndex((task) => task.id === id);
    if (index < 0) return failure('找不到该任务。');
    const issuedAt = parseIsoInstant(dependencies.now());
    if (issuedAt === null) return failure('当前时间无效。');

    const task = cloneState(day.tasks[index]);
    clearContinuationLinks(task);
    day.tasks.splice(index, 1);
    const undoToken = dependencies.createId();
    undoRecord = { token: undoToken, date: day.date, index, task, expiresAt: issuedAt + 6000 };
    return success({ undoToken });
  }

  function undo(token) {
    const record = undoRecord && undoRecord.token === token ? undoRecord : null;
    if (!record) return failure('撤销信息无效或已经使用。');
    const currentTime = parseIsoInstant(dependencies.now());
    if (currentTime === null) return failure('当前时间无效。');
    if (currentTime > record.expiresAt) {
      undoRecord = null;
      return failure('撤销时间已结束。');
    }
    const day = findDay(record.date);
    if (!day || day.tasks.some((task) => task.id === record.task.id)) {
      return failure('原始任务无法恢复。');
    }

    const restored = cloneState(record.task);
    if (!canRestoreContinuationLinks(record.date, restored)) {
      return failure('任务延续关系已经发生变化，无法撤销。');
    }
    day.tasks.splice(Math.min(record.index, day.tasks.length), 0, restored);
    restoreContinuationLinks(record.date, restored);
    undoRecord = null;
    return success();
  }

  function continueTask(sourceDate, id) {
    const sourceDay = state.history.find((day) => day.date === sourceDate);
    if (!sourceDay) return failure('找不到该历史日期。');
    const source = sourceDay.tasks.find((task) => task.id === id);
    if (!source) return failure('找不到该历史任务。');
    if (source.completed) return failure('已完成的历史任务无需延续。');
    if (source.hasBeenContinued || source.continuedToTaskId) {
      return failure('该历史任务已经延续过。');
    }

    const continuedId = dependencies.createId();
    if (findTaskById(continuedId)) return failure('生成的任务 ID 已存在。');
    const continued = createTask(continuedId, source.text, dependencies.now());
    continued.continuedFromTaskId = source.id;
    continued.continuedFromDate = sourceDay.date;
    state.activeDay.tasks.push(continued);
    source.hasBeenContinued = true;
    source.continuedToTaskId = continued.id;
    source.continuedToDate = state.activeDay.date;
    return success();
  }

  function ensureCurrentDay(now) {
    const currentDate = localDateOf(now);
    if (!currentDate) return { ...failure('当前时间无效。'), rolledOver: false };
    const comparison = currentDate.localeCompare(state.activeDay.date);
    if (comparison === 0) return { ...success(), rolledOver: false, clockMovedBackward: false };
    if (comparison < 0) {
      return {
        ...success(),
        rolledOver: false,
        clockMovedBackward: true,
        warning: '系统日期早于当前清单日期；为保护历史记录，DoTodo 没有回退日期。'
      };
    }

    state.activeDay.closedAt = now;
    state.history.unshift(state.activeDay);
    state.activeDay = { date: currentDate, closedAt: null, tasks: [] };
    return { ...success(), rolledOver: true, clockMovedBackward: false };
  }

  function updateSettings(patch) {
    const allowedKeys = new Set([
      'backgroundOpacity',
      'windowMode',
      'closeToTray',
      'launchAtLogin'
    ]);
    if (!isPlainObject(patch) || Object.keys(patch).length === 0 ||
        Object.keys(patch).some((key) => !allowedKeys.has(key))) {
      return failure('设置变更无效。');
    }
    return applyCandidate({
      ...state,
      settings: { ...state.settings, ...patch }
    });
  }

  function updateWindowBounds(patch) {
    const allowedKeys = new Set(['x', 'y', 'width', 'height']);
    if (!isPlainObject(patch) || Object.keys(patch).length === 0 ||
        Object.keys(patch).some((key) => !allowedKeys.has(key))) {
      return failure('窗口位置或尺寸变更无效。');
    }
    return applyCandidate({
      ...state,
      windowBounds: { ...state.windowBounds, ...patch }
    });
  }

  function replaceState(nextState) {
    const validation = validateState(nextState);
    if (!validation.ok) return failure(`导入状态无效：${validation.error}`);
    state = validation.state;
    undoRecord = null;
    return success();
  }

  function applyCandidate(candidate) {
    const validation = validateState(candidate);
    if (!validation.ok) return failure(validation.error);
    state = validation.state;
    return success();
  }

  function unavailableTask(id) {
    const existsInHistory = state.history.some((day) => day.tasks.some((task) => task.id === id));
    return failure(existsInHistory ? '历史任务是只读的。' : '找不到该任务。');
  }

  function findTodayTask(id) {
    return state.activeDay.tasks.find((task) => task.id === id);
  }

  function findTaskById(id) {
    return findTodayTask(id) || state.history.flatMap((day) => day.tasks).find((task) => task.id === id);
  }

  function findDay(date) {
    return state.activeDay.date === date
      ? state.activeDay
      : state.history.find((day) => day.date === date);
  }

  function findTask(date, id) {
    const day = date && id ? findDay(date) : null;
    return day ? day.tasks.find((task) => task.id === id) : null;
  }

  function clearContinuationLinks(task) {
    const source = findTask(task.continuedFromDate, task.continuedFromTaskId);
    if (source && source.continuedToTaskId === task.id) {
      source.hasBeenContinued = true;
      source.continuedToTaskId = null;
      source.continuedToDate = null;
    }
    const target = findTask(task.continuedToDate, task.continuedToTaskId);
    if (target && target.continuedFromTaskId === task.id) {
      target.continuedFromTaskId = null;
      target.continuedFromDate = null;
    }
  }

  function canRestoreContinuationLinks(taskDate, task) {
    if (task.continuedFromTaskId) {
      const source = findTask(task.continuedFromDate, task.continuedFromTaskId);
      if (!source || (source.continuedToTaskId && source.continuedToTaskId !== task.id)) return false;
    }
    if (task.continuedToTaskId) {
      const target = findTask(task.continuedToDate, task.continuedToTaskId);
      if (!target || (target.continuedFromTaskId && target.continuedFromTaskId !== task.id)) return false;
    }
    return taskDate !== null;
  }

  function restoreContinuationLinks(taskDate, task) {
    const source = findTask(task.continuedFromDate, task.continuedFromTaskId);
    if (source) {
      source.hasBeenContinued = true;
      source.continuedToTaskId = task.id;
      source.continuedToDate = taskDate;
    }
    const target = findTask(task.continuedToDate, task.continuedToTaskId);
    if (target) {
      target.continuedFromTaskId = task.id;
      target.continuedFromDate = taskDate;
    }
  }

  return Object.freeze({
    getSnapshot,
    addTask,
    editTask,
    toggleTask,
    reorderTask,
    deleteTodayTask,
    deleteHistoryTask,
    undo,
    continueTask,
    ensureCurrentDay,
    updateSettings,
    updateWindowBounds,
    replaceState
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) return { ok: false, error: '任务内容不能为空。' };
  if (normalized.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `任务内容不能超过 ${MAX_TEXT_LENGTH} 个字符。` };
  }
  return { ok: true, text: normalized };
}

function createTask(id, text, createdAt) {
  return {
    id,
    text,
    completed: false,
    createdAt,
    completedAt: null,
    continuedFromTaskId: null,
    continuedFromDate: null,
    continuedToTaskId: null,
    continuedToDate: null,
    hasBeenContinued: false
  };
}

module.exports = { createDailyTodoEngine };
