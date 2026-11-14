/**
 * 窗口位置兜底。
 *
 * 保存下来的位置不可盲目相信：坐标写错一次、显示器拔掉或分辨率变化，窗口就会
 * 被摆到屏幕外——进程还在跑、托盘图标也在，但用户什么都看不到。这类"看得见却
 * 找不到"的故障比崩溃更糟，因为它不像故障。
 *
 * 规则：矩形必须在一块屏幕的工作区里露出足够大的一块，否则回到主屏居中。
 * 坐标系是屏幕坐标（Electron 的 display.workArea 就是屏幕坐标）。
 */

/** 至少要有这么多像素落在屏幕内，才算"用户能找到"。 */
const MIN_VISIBLE = 40;

function normalizeWindowBounds(bounds, displays) {
  const width = Number.isFinite(bounds?.width) ? bounds.width : 390;
  const height = Number.isFinite(bounds?.height) ? bounds.height : 610;
  const list = Array.isArray(displays) && displays.length > 0 ? displays : null;

  if (!list) return { width, height, x: 0, y: 0 };

  const primary = list[0].workArea;

  if (Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y)) {
    const candidate = { width, height, x: bounds.x, y: bounds.y };
    if (isFindable(candidate, list)) return candidate;
  }

  return {
    width,
    height,
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2)
  };
}

function isFindable(rect, displays) {
  for (const display of displays) {
    const area = display.workArea;
    const overlapX = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    const overlapY = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    if (overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE) return true;
  }
  return false;
}

module.exports = { normalizeWindowBounds, MIN_VISIBLE };
