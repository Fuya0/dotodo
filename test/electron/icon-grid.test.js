const test = require('node:test');
const assert = require('node:assert/strict');

const { gridOrigin, occupiedCells, planBounds, snapToCell } = require('../../src/electron/icon-grid');

/** 这台机器上真实读到的几何：格子 76x100，原点 (14,2)，图标铺满上面 5 行。 */
const CELL = { width: 76, height: 100 };
const ORIGIN = { x: 14, y: 2 };
const SCREEN = { width: 1920, height: 1032 }; // 已排除任务栏

function fillRows(rows, columns = 25) {
  const positions = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({ x: ORIGIN.x + column * CELL.width, y: ORIGIN.y + row * CELL.height });
    }
  }
  return positions;
}

test('从图标位置反推网格原点', () => {
  const positions = [
    { x: 14, y: 2 }, { x: 90, y: 2 }, { x: 14, y: 102 }, { x: 166, y: 302 }
  ];
  assert.deepEqual(gridOrigin(positions, CELL), { x: 14, y: 2 });
});

test('网格原点取多数派，不被一个没对齐的图标带偏', () => {
  // 桌面上有个拖过去没松手的图标是常事；用它当基准整张网格会偏。
  const positions = [
    { x: 14, y: 2 }, { x: 90, y: 102 }, { x: 166, y: 202 }, { x: 200, y: 2 }
  ];
  assert.deepEqual(gridOrigin(positions, CELL), { x: 14, y: 2 });
});

test('没有图标时原点落在 0，不会算出 NaN', () => {
  assert.deepEqual(gridOrigin([], CELL), { x: 0, y: 0 });
});

test('图标位置换算成它占的格子', () => {
  const taken = occupiedCells([{ x: 14, y: 2 }, { x: 90, y: 202 }], CELL, ORIGIN);
  assert.deepEqual([...taken].sort(), ['0,0', '1,2']);
});

test('吸附：位置取最近格线，尺寸取整数格', () => {
  assert.deepEqual(
    snapToCell({ x: 765, y: 211, width: 390, height: 610 }, CELL, ORIGIN),
    { x: 14 + 10 * 76, y: 2 + 2 * 100, width: 5 * 76, height: 6 * 100 }
  );
});

test('目标格子空着时原地吸附，不做多余移动', () => {
  const positions = fillRows(5);
  const planned = planBounds({
    bounds: { x: 762, y: 500, width: 380, height: 500 },
    cell: CELL, origin: ORIGIN, positions, screen: SCREEN
  });
  // 第 5 行（y=502）在图标下面，是空的；只把它吸到格线上，不该挪走。
  assert.deepEqual(planned, { x: ORIGIN.x + 10 * 76, y: ORIGIN.y + 5 * 100, width: 380, height: 500 });
});

test('目标格子上有图标时，挪到最近的空格子', () => {
  const positions = fillRows(5);
  const planned = planBounds({
    bounds: { x: 14, y: 202, width: 380, height: 500 }, // 第 2 行，被图标占着
    cell: CELL, origin: ORIGIN, positions, screen: SCREEN
  });
  // 图标占 0~4 行，最近的空位是第 5 行。
  assert.equal(planned.y, ORIGIN.y + 5 * 100);
  assert.equal(planned.x, 14);
  assert.equal(planned.height, 500);
});

test('放不下就一格格减行，而不是将就着压在图标上', () => {
  const positions = fillRows(5);
  // 610 高 → 6 行；图标下面只剩 5 行（y 502..1002，可用高度 1032）。
  const planned = planBounds({
    bounds: { x: 14, y: 2, width: 380, height: 610 },
    cell: CELL, origin: ORIGIN, positions, screen: SCREEN
  });
  assert.equal(planned.height, 500, '应该缩到 5 行塞进图标下面');
  assert.equal(planned.y, ORIGIN.y + 5 * 100);
});

test('桌面被图标占满时返回 null，调用方保持原样', () => {
  const positions = fillRows(11);
  const planned = planBounds({
    bounds: { x: 14, y: 2, width: 380, height: 500 },
    cell: CELL, origin: ORIGIN, positions, screen: SCREEN
  });
  assert.equal(planned, null);
});

test('窗口跑到屏幕外时会被拉回可用区域', () => {
  const planned = planBounds({
    bounds: { x: 5000, y: 4000, width: 380, height: 500 },
    cell: CELL, origin: ORIGIN, positions: [], screen: SCREEN
  });
  assert.ok(planned.x >= 0 && planned.x + planned.width <= SCREEN.width, `x 越界：${planned.x}`);
  assert.ok(planned.y >= 0 && planned.y + planned.height <= SCREEN.height, `y 越界：${planned.y}`);
});

test('返回的矩形永远落在网格线上', () => {
  const positions = fillRows(5);
  for (const bounds of [
    { x: 0, y: 0, width: 390, height: 610 },
    { x: 333, y: 777, width: 500, height: 450 },
    { x: 1900, y: 1000, width: 330, height: 420 }
  ]) {
    const planned = planBounds({ bounds, cell: CELL, origin: ORIGIN, positions, screen: SCREEN });
    if (planned === null) continue;
    assert.equal((planned.x - ORIGIN.x) % CELL.width, 0, `x 没对齐：${planned.x}`);
    assert.equal((planned.y - ORIGIN.y) % CELL.height, 0, `y 没对齐：${planned.y}`);
    assert.equal(planned.width % CELL.width, 0);
    assert.equal(planned.height % CELL.height, 0);
  }
});
