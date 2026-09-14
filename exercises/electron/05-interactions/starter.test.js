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

test('dropInstruction 判断落点以及是否真的发生了移动', () => {
  assert.deepEqual(dropInstruction([10, 20, 30], 5, 3), { targetIndex: 0, changed: true });
  assert.deepEqual(dropInstruction([10, 20, 30], 25, 3), { targetIndex: 2, changed: true });
  assert.deepEqual(dropInstruction([10, 20, 30], 25, 2), { targetIndex: 2, changed: false });
  // 越过最后一个中点 = 落到末尾 = midpoints.length（不是 length - 1）。
  assert.deepEqual(dropInstruction([10, 20], 100, 2), { targetIndex: 2, changed: false });
  assert.deepEqual(dropInstruction([10, 20], 100, 1), { targetIndex: 2, changed: true });
});

test('dropInstruction 对空候选返回 -1', () => {
  assert.deepEqual(dropInstruction([], 5, 0), { targetIndex: -1, changed: false });
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
