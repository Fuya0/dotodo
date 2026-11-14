const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindowBounds } = require('../../src/electron/window-bounds');

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
const LEFT = { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } };
const DISPLAYS = [PRIMARY, LEFT];

test('可见位置原样保留', () => {
  const bounds = { x: -1880, y: 60, width: 390, height: 610 };
  assert.deepEqual(normalizeWindowBounds(bounds, DISPLAYS), bounds);
});

test('跑到屏幕外的位置回到主屏居中', () => {
  const bounds = { x: -19104, y: 257, width: 380, height: 595 };
  assert.deepEqual(normalizeWindowBounds(bounds, DISPLAYS), {
    x: 770, y: 219, width: 380, height: 595
  });
});

test('没有保存位置时居中到主屏', () => {
  assert.deepEqual(normalizeWindowBounds({ width: 390, height: 610 }, DISPLAYS), {
    x: 765, y: 211, width: 390, height: 610
  });
});

test('只剩一条缝露在屏幕边也算不可见，回到主屏', () => {
  const bounds = { x: -2280, y: 60, width: 390, height: 610 };
  assert.deepEqual(normalizeWindowBounds(bounds, DISPLAYS), {
    x: 765, y: 211, width: 390, height: 610
  });
});
