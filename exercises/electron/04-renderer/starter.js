/**
 * 练习 04：界面投影、键盘导航与视觉常量（请手写实现）
 *
 * 规则：下面的函数都不依赖 DOM，所以你可以在 Node 里直接跑测试。
 * 请只使用 JavaScript 标准能力，不要 require 任何模块。
 */

/* ---------- 第一部分：界面投影与键盘导航 ---------- */

function summarizeProgress(flags) {
  throw new Error('请实现 summarizeProgress');
}

function toRows(tasks) {
  throw new Error('请实现 toRows');
}

function groupByCompleted(tasks) {
  throw new Error('请实现 groupByCompleted');
}

function nextFocusIndex(current, total, delta) {
  throw new Error('请实现 nextFocusIndex');
}

function describeSurface({ r, g, b, alpha }) {
  throw new Error('请实现 describeSurface');
}

function buildClassName(state) {
  throw new Error('请实现 buildClassName');
}

/* ---------- 第二部分：把「看得清」算出来 ---------- */

function parseColor(value) {
  throw new Error('请实现 parseColor');
}

function compositeOver(foreground, background) {
  throw new Error('请实现 compositeOver');
}

function contrastRatio(foreground, background) {
  throw new Error('请实现 contrastRatio');
}

module.exports = {
  summarizeProgress,
  toRows,
  groupByCompleted,
  nextFocusIndex,
  describeSurface,
  buildClassName,
  parseColor,
  compositeOver,
  contrastRatio
};
