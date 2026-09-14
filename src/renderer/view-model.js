/**
 * 渲染层投影函数。
 *
 * 这里只做一件事：把主进程返回的状态快照，转换成界面可以直接读取的只读视图数据。
 * 它不接触 DOM、不接触 Node、也不接触 Electron，所以在 Node 里可以直接测试。
 *
 * 浏览器兼容说明：本文件既被 `node --test` 用 `require()` 加载，也被
 * `src/renderer/index.html` 用普通 <script> 加载。普通脚本里顶层函数声明会成为
 * 全局变量，而 `module` 不存在，于是下面那段导出会被安全跳过。
 */

const WEEKDAY_NAMES = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_COPY = Object.freeze({
  title: '清单空空的',
  copy: '写下一件小事，然后轻松完成它。'
});

const HISTORY_EMPTY_COPY = Object.freeze({
  title: '还没有历史记录',
  copy: '每过一天，当天的清单会完整留在这里。'
});

/** 把 `2026-09-13` 变成 `9月13日 周日`；非法输入返回空字符串。 */
function formatDateLabel(localDate) {
  if (!isLocalDate(localDate)) return '';
  const date = new Date(`${localDate}T00:00:00`);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日 ${WEEKDAY_NAMES[date.getDay()]}`;
}

/** 把完整快照投影成 Today 页面需要的视图数据。 */
function deriveTodayView(snapshot) {
  assertSnapshot(snapshot);

  const tasks = snapshot.activeDay.tasks.map(toTaskRow);
  const todayCount = tasks.length;
  const completedCount = tasks.filter((row) => row.completed).length;
  const progressRatio = todayCount === 0 ? 0 : completedCount / todayCount;

  return {
    date: snapshot.activeDay.date,
    dateLabel: formatDateLabel(snapshot.activeDay.date),
    tasks,
    todayCount,
    completedCount,
    remainingCount: todayCount - completedCount,
    progressRatio,
    progressPercent: Math.round(progressRatio * 100),
    progressLabel: `${completedCount} / ${todayCount}`,
    hasTasks: todayCount > 0,
    isEmpty: todayCount === 0,
    empty: todayCount === 0 ? { ...EMPTY_COPY } : null
  };
}

/** 把历史日期投影成按日期倒序的只读列表。 */
function deriveHistoryView(snapshot) {
  assertSnapshot(snapshot);

  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  // 先复制再排序：sort 会就地修改数组，直接排快照里的 history 就破坏了「只读」约定。
  const days = [...history].sort(compareDaysDescending).map(toHistoryDay);

  return {
    dayCount: days.length,
    days,
    isEmpty: days.length === 0,
    empty: days.length === 0 ? { ...HISTORY_EMPTY_COPY } : null
  };
}

/** 把设置投影成界面控件需要的值和选中状态。 */
function deriveSettingsView(snapshot) {
  assertSnapshot(snapshot);

  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};

  return {
    closeToTray: Boolean(settings.closeToTray),
    launchAtLogin: Boolean(settings.launchAtLogin)
  };
}

/**
 * 拖拽落点。
 *
 * `rows` 是**除被拖行之外**每一行的纵向范围（`{ top, bottom }`，按屏幕从上到下），
 * `fromIndex` 是被拖行在完整列表里的原始下标。
 *
 * 规则：**指针落在哪一行，就插到那一行的后面或前面 —— 取决于你往下拖还是往上拖。**
 *
 *   - 往下拖（被拖行的原位置在目标行之上）→ 插到目标行**之后**；
 *   - 往上拖（被拖行的原位置在目标行之下）→ 插到目标行**之前**。
 *
 * 返回 `{ targetIndex, markerIndex, side }`：
 *   - `targetIndex` 是「移除被拖行之后」的列表下标，正好是 reorderTask 需要的目标位置；
 *   - `markerIndex` / `side` 告诉界面把落点线画在哪一行的上边还是下边。
 *
 * 为什么不用「越过中线才算插到后面」那套：那套规则下想跟第 3 行换位，指针必须落到
 * 第 3 行的**下半部分**；停在上半部分就变成"插到第 3 行之前"，看起来成了跟第 2 行换位。
 * 一次真机验收报的就是这个（"我 1 和 3 换位，结果是 1 和 2 换位"）。
 */
function resolveDropIndex(rows, clientY, fromIndex) {
  if (!Array.isArray(rows) || rows.length === 0) return { targetIndex: -1, markerIndex: -1, side: null };
  if (!Number.isFinite(clientY)) return { targetIndex: -1, markerIndex: -1, side: null };

  const hovered = rows.findIndex((row) => clientY >= row.top && clientY <= row.bottom);

  if (hovered === -1) {
    // 落在所有行之外的空白里：上面就是开头，下面就是末尾。
    if (clientY < rows[0].top) {
      return { targetIndex: 0, markerIndex: 0, side: 'before' };
    }
    return { targetIndex: rows.length, markerIndex: rows.length - 1, side: 'after' };
  }

  // 还原这一行在完整列表里的下标（others 里排在 fromIndex 之后的都往后错了一位）
  const hoveredFullIndex = hovered < fromIndex ? hovered : hovered + 1;
  const movingDown = fromIndex <= hoveredFullIndex;

  return {
    targetIndex: movingDown ? hovered + 1 : hovered,
    markerIndex: hovered,
    side: movingDown ? 'after' : 'before'
  };
}

/** 一行任务只暴露界面真正需要的字段，顺序由 position 表达。 */
function toTaskRow(task, position) {
  return {
    id: task.id,
    position,
    text: task.text,
    completed: Boolean(task.completed),
    completedAt: task.completedAt ?? null
  };
}

function toHistoryDay(day) {
  const tasks = Array.isArray(day.tasks) ? day.tasks.map(toHistoryRow) : [];
  const completedCount = tasks.filter((row) => row.completed).length;
  return {
    date: day.date,
    dateLabel: formatDateLabel(day.date),
    tasks,
    taskCount: tasks.length,
    completedCount,
    progressLabel: `${completedCount} / ${tasks.length}`
  };
}

function toHistoryRow(task, position) {
  const completed = Boolean(task.completed);
  const continuedOnward = Boolean(task.hasBeenContinued) || Boolean(task.continuedToTaskId);
  return {
    id: task.id,
    position,
    text: task.text,
    completed,
    isContinuedFrom: Boolean(task.continuedFromTaskId),
    continuedFromDate: task.continuedFromDate ?? null,
    canContinue: !completed && !continuedOnward,
    statusLabel: historyStatusLabel(task, continuedOnward)
  };
}

function historyStatusLabel(task, continuedOnward) {
  if (continuedOnward) {
    return task.continuedToDate ? `已延续到 ${formatDateLabel(task.continuedToDate)}` : '已延续过';
  }
  if (task.continuedFromTaskId && task.continuedFromDate) {
    return `延续自 ${formatDateLabel(task.continuedFromDate)}`;
  }
  return null;
}

function compareDaysDescending(left, right) {
  if (left.date === right.date) return 0;
  return left.date < right.date ? 1 : -1;
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' ||
      !snapshot.activeDay || typeof snapshot.activeDay !== 'object' ||
      !Array.isArray(snapshot.activeDay.tasks)) {
    throw new TypeError('投影函数需要一个包含 activeDay.tasks 数组的状态快照。');
  }
}

function isLocalDate(value) {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deriveTodayView,
    deriveHistoryView,
    deriveSettingsView,
    formatDateLabel,
    resolveDropIndex
  };
}
