/**
 * 练习 05：交互状态机（请手写实现）
 *
 * 规则：下面的函数都不依赖 DOM，所以你可以在 Node 里直接跑测试。
 * 请只使用 JavaScript 标准能力，不要 require 任何模块。
 */

function moveItem(items, from, to) {
  throw new Error('请实现 moveItem');
}

function dropInstruction(midpoints, clientY, fromIndex) {
  throw new Error('请实现 dropInstruction');
}

function undoWindow(issuedAt, now) {
  throw new Error('请实现 undoWindow');
}

function summarizeHistory(days) {
  throw new Error('请实现 summarizeHistory');
}

function reduceDrag(state, event) {
  throw new Error('请实现 reduceDrag');
}

module.exports = {
  moveItem,
  dropInstruction,
  undoWindow,
  summarizeHistory,
  reduceDrag
};
