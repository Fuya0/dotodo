const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeProgress,
  toRows,
  groupByCompleted,
  nextFocusIndex,
  describeSurface,
  buildClassName
} = require('./starter');

test('summarizeProgress 统计完成数并把空清单的进度归零', () => {
  assert.deepEqual(summarizeProgress([]), {
    total: 0, completed: 0, remaining: 0, ratio: 0, percent: 0, label: '0 / 0'
  });
  assert.deepEqual(summarizeProgress([true, false, true]), {
    total: 3, completed: 2, remaining: 1, ratio: 2 / 3, percent: 67, label: '2 / 3'
  });
  assert.deepEqual(summarizeProgress([true, true, true, true]), {
    total: 4, completed: 4, remaining: 0, ratio: 1, percent: 100, label: '4 / 4'
  });
});

test('summarizeProgress 按真假值判断完成，而不是只认 true', () => {
  assert.deepEqual(summarizeProgress([1, 0, 'x', null, undefined]), {
    total: 5, completed: 2, remaining: 3, ratio: 0.4, percent: 40, label: '2 / 5'
  });
});

test('toRows 只保留合法任务，并按结果顺序重新编号', () => {
  const rows = toRows([
    { id: 'a', text: '写周报', completed: false },
    null,
    { id: '', text: '缺少 ID' },
    { id: 'b', text: '      ', completed: true },
    { id: 'c', text: '锻炼 20 分钟', completed: true }
  ]);
  assert.deepEqual(rows, [
    { index: 0, id: 'a', text: '写周报', done: false },
    { index: 1, id: 'c', text: '锻炼 20 分钟', done: true }
  ]);
});

test('toRows 去掉首尾空白，并对空输入返回空数组', () => {
  assert.deepEqual(toRows([]), []);
  assert.deepEqual(toRows([{ id: 'a', text: '  买菜  ' }]), [
    { index: 0, id: 'a', text: '买菜', done: false }
  ]);
});

test('groupByCompleted 按完成状态分桶并保持原顺序', () => {
  const groups = groupByCompleted([
    { id: 'a', completed: true },
    { id: 'b', completed: false },
    { id: 'c', completed: true },
    { id: 'd', completed: false }
  ]);
  assert.deepEqual(groups, { done: ['a', 'c'], pending: ['b', 'd'] });
  assert.deepEqual(groupByCompleted([]), { done: [], pending: [] });
});

test('nextFocusIndex 在两端夹紧而不是循环', () => {
  assert.equal(nextFocusIndex(0, 3, 1), 1);
  assert.equal(nextFocusIndex(2, 3, 1), 2);
  assert.equal(nextFocusIndex(0, 3, -1), 0);
  assert.equal(nextFocusIndex(1, 3, -1), 0);
});

test('nextFocusIndex 处理空列表和越界的起点', () => {
  assert.equal(nextFocusIndex(0, 0, 1), -1);
  assert.equal(nextFocusIndex(0, 0, -1), -1);
  assert.equal(nextFocusIndex(9, 3, 1), 2);
  assert.equal(nextFocusIndex(-4, 3, 1), 0);
});

test('describeSurface 把透明度夹到 0.55–1 并给出百分比', () => {
  assert.deepEqual(describeSurface(0.82), { value: 0.82, percent: 82, label: '82%', cssValue: '0.82' });
  assert.deepEqual(describeSurface(0.1), { value: 0.55, percent: 55, label: '55%', cssValue: '0.55' });
  assert.deepEqual(describeSurface(2), { value: 1, percent: 100, label: '100%', cssValue: '1' });
  assert.deepEqual(describeSurface(0.825), { value: 0.825, percent: 83, label: '83%', cssValue: '0.825' });
});

test('describeSurface 对非数字返回 null', () => {
  assert.equal(describeSurface(undefined), null);
  assert.equal(describeSurface(null), null);
  assert.equal(describeSurface('0.8'), null);
  assert.equal(describeSurface(Number.NaN), null);
});

test('buildClassName 只拼接生效的修饰类', () => {
  assert.equal(buildClassName({}), 'todo-row');
  assert.equal(buildClassName({ completed: false, selected: false, continued: false }), 'todo-row');
  assert.equal(buildClassName({ completed: true }), 'todo-row completed');
  assert.equal(
    buildClassName({ completed: true, selected: true, continued: true }),
    'todo-row completed selected continued'
  );
  assert.equal(buildClassName({ selected: true, continued: true }), 'todo-row selected continued');
});
