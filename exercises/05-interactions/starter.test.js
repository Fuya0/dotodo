const test = require('node:test');
const assert = require('node:assert/strict');
const {
  moveItem,
  dropInstruction,
  undoWindow,
  summarizeHistory,
  reduceDrag
} = require('./starter');

test('moveItem 把元素搬到新位置并返回新数组', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem([], 0, 0), []);
});

test('moveItem 对越界下标原样返回副本，并且不修改传入数组', () => {
  const source = ['a', 'b', 'c'];
  const outOfRange = moveItem(source, 0, 9);
  assert.deepEqual(outOfRange, ['a', 'b', 'c']);
  assert.notEqual(outOfRange, source);
  assert.deepEqual(moveItem(source, -1, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(source, 1.5, 0), ['a', 'b', 'c']);
  assert.deepEqual(source, ['a', 'b', 'c']);
});

// 除被拖行之外的那些行的纵向范围，从上到下。行高 20。
const ROWS = [
  { top: 0, bottom: 20 },
  { top: 20, bottom: 40 },
  { top: 40, bottom: 60 }
];

test('dropInstruction：往下拖，插到指针所在那一行的后面', () => {
  // 被拖的是原来的第 1 行，所以 ROWS[0]、ROWS[1]、ROWS[2] 分别是原来的第 2、3、4 行。
  // 指针停在第 3 行（ROWS[1]）里 —— 结果必须是"跟第 3 行换位"，也就是 targetIndex 2。
  assert.deepEqual(
    dropInstruction(ROWS, 30, 0),
    { targetIndex: 2, lineIndex: 1, lineSide: 'after' }
  );
  // 指针停在第 2 行（ROWS[0]）里 → 没动。
  assert.deepEqual(
    dropInstruction(ROWS, 10, 0),
    { targetIndex: 1, lineIndex: 0, lineSide: 'after' }
  );
});

test('dropInstruction：往上拖，插到指针所在那一行的前面', () => {
  // 被拖的是原来的第 3 行：ROWS[0]、ROWS[1]、ROWS[2] 是原来的第 1、2、4 行。
  // 指针停在第一行里 → 挪到最前。
  assert.deepEqual(
    dropInstruction(ROWS, 10, 2),
    { targetIndex: 0, lineIndex: 0, lineSide: 'before' }
  );
  // 指针停在最后一行里 → 挪到最后。
  assert.deepEqual(
    dropInstruction(ROWS, 50, 2),
    { targetIndex: 3, lineIndex: 2, lineSide: 'after' }
  );
});

test('dropInstruction：落在列表之外，以及读不到几何时', () => {
  assert.deepEqual(dropInstruction(ROWS, -5, 0), { targetIndex: 0, lineIndex: 0, lineSide: 'before' });
  // 落到末尾是 ROWS.length，不是 length - 1。
  assert.deepEqual(dropInstruction(ROWS, 100, 0), { targetIndex: 3, lineIndex: 2, lineSide: 'after' });
  assert.deepEqual(dropInstruction([], 10, 0), { targetIndex: -1, lineIndex: -1, lineSide: null });
  assert.deepEqual(dropInstruction(ROWS, Number.NaN, 0), { targetIndex: -1, lineIndex: -1, lineSide: null });
});

test('undoWindow 给出剩余时间与是否过期', () => {
  assert.deepEqual(undoWindow(0, 0), { remainingMs: 6000, expired: false });
  assert.deepEqual(undoWindow(0, 5999), { remainingMs: 1, expired: false });
  assert.deepEqual(undoWindow(0, 6000), { remainingMs: 0, expired: false });
  assert.deepEqual(undoWindow(0, 6001), { remainingMs: 0, expired: true });
});

test('undoWindow 在时钟回拨时不会超过总时长', () => {
  assert.deepEqual(undoWindow(0, -5), { remainingMs: 6000, expired: false });
  assert.deepEqual(undoWindow(1000, 2500), { remainingMs: 4500, expired: false });
});

test('summarizeHistory 汇总所有历史天数', () => {
  assert.deepEqual(summarizeHistory([]), {
    dayCount: 0, taskCount: 0, completedCount: 0, completionRate: 0, bestDay: null
  });
  assert.deepEqual(summarizeHistory([
    { date: '2026-09-12', tasks: [{ completed: true }, { completed: false }, { completed: true }] },
    { date: '2026-09-11', tasks: [{ completed: true }] }
  ]), {
    dayCount: 2, taskCount: 4, completedCount: 3, completionRate: 0.75, bestDay: '2026-09-12'
  });
});

test('summarizeHistory 在数量相同时保留先出现的那一天', () => {
  assert.equal(summarizeHistory([
    { date: '2026-09-12', tasks: [{ completed: true }] },
    { date: '2026-09-11', tasks: [{ completed: true }, { completed: true }] },
    { date: '2026-09-10', tasks: [{ completed: true }, { completed: true }] }
  ]).bestDay, '2026-09-11');
});

test('summarizeHistory 在没有任何完成项时返回 null', () => {
  assert.equal(summarizeHistory([
    { date: '2026-09-12', tasks: [{ completed: false }] }
  ]).bestDay, null);
  assert.equal(summarizeHistory([
    { date: '2026-09-12', tasks: [] },
    { date: '2026-09-11', tasks: [{ completed: false }] }
  ]).bestDay, null);
});

test('reduceDrag 从空闲状态开始拖拽', () => {
  assert.deepEqual(reduceDrag({ status: 'idle' }, { type: 'start', id: 'a', index: 1 }), {
    state: { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 },
    command: null
  });
  assert.deepEqual(reduceDrag({ status: 'idle' }, { type: 'start', id: 'a', index: -1 }), {
    state: { status: 'idle' },
    command: null
  });
});

test('reduceDrag 在拖拽过程中记录落点', () => {
  const dragging = { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 };
  assert.deepEqual(reduceDrag(dragging, { type: 'move', targetIndex: 3 }), {
    state: { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 3 },
    command: null
  });
  assert.deepEqual(reduceDrag(dragging, { type: 'move', targetIndex: 1.5 }), {
    state: dragging,
    command: null
  });
});

test('reduceDrag 只在位置真的变化时发出重排命令', () => {
  const dragging = { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 };
  assert.deepEqual(reduceDrag(dragging, { type: 'finish' }), {
    state: { status: 'idle' },
    command: null
  });
  assert.deepEqual(reduceDrag({ ...dragging, targetIndex: 3 }, { type: 'finish' }), {
    state: { status: 'idle' },
    command: { type: 'reorder', id: 'a', targetIndex: 3 }
  });
  assert.deepEqual(reduceDrag({ ...dragging, targetIndex: 3 }, { type: 'cancel' }), {
    state: { status: 'idle' },
    command: null
  });
});

test('reduceDrag 忽略空闲状态下的移动、结束和重复开始', () => {
  const idle = { status: 'idle' };
  assert.deepEqual(reduceDrag(idle, { type: 'move', targetIndex: 2 }), { state: { status: 'idle' }, command: null });
  assert.deepEqual(reduceDrag(idle, { type: 'finish' }), { state: { status: 'idle' }, command: null });
  assert.deepEqual(reduceDrag(idle, { type: 'cancel' }), { state: { status: 'idle' }, command: null });

  const dragging = { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 };
  assert.deepEqual(reduceDrag(dragging, { type: 'start', id: 'b', index: 0 }), {
    state: dragging,
    command: null
  });
});
