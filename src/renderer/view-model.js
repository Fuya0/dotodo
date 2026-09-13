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
  if (!snapshot || typeof snapshot !== 'object' ||
      !snapshot.activeDay || typeof snapshot.activeDay !== 'object' ||
      !Array.isArray(snapshot.activeDay.tasks)) {
    throw new TypeError('deriveTodayView 需要一个包含 activeDay.tasks 数组的快照。');
  }

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

/** 一行任务只暴露界面真正需要的字段，顺序由 position 表达。 */
function toTaskRow(task, position) {
  return {
    id: task.id,
    position,
    text: task.text,
    completed: Boolean(task.completed),
    completedAt: task.completedAt ?? null,
    isContinued: Boolean(task.continuedFromTaskId),
    continuedFromDate: task.continuedFromDate ?? null
  };
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
  module.exports = { deriveTodayView, formatDateLabel };
}
