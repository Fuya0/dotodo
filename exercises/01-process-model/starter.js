function clamp(value, minimum, maximum) {
  throw new Error('请实现 clamp');
}

function normalizeTaskText(value) {
  throw new Error('请实现 normalizeTaskText');
}

function moveItem(items, fromIndex, toIndex) {
  throw new Error('请实现 moveItem');
}

function createSequence(values) {
  throw new Error('请实现 createSequence');
}

// const state = {
//   activeDay: { date: '2026-09-13', tasks: [{ id: '1' }] }, // 今天：13号，有一件事
//   history:  [{ date: '2026-09-12', tasks: [] }]            // 昨天：12号
// };
function rollover(state, nextDate) {
  throw new Error('请实现 rollover');
}

module.exports = { clamp, normalizeTaskText, moveItem, createSequence, rollover };
