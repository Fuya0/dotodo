/**
 * 桌面图标网格。
 *
 * 目标是把窗口做成"桌面上的一个部件"：和图标排在同一套格子上，并且**不压住任何图标**。
 * Windows 没有「给窗口预留位置、图标自动让开」这种接口，所以只能反过来做 ——
 * 先读出图标占了哪些格子，再给窗口找一块空格子。
 *
 * 这里全是纯函数：喂给它图标位置就能算出结果，不需要真的 Windows。真正的原生读取
 * 在 `win32.js`，桌面层负责把两边接起来。
 *
 * 坐标一律是屏幕坐标（像素）。
 */

/**
 * 从图标位置反推网格原点。
 *
 * 每个图标都在 `原点 + 整数格` 上，所以所有图标的坐标对格子尺寸取余应该一样。
 * 取**出现次数最多**的那个余数，而不是第一个：桌面上偶尔会有一个没对齐的图标
 * （拖过去没松手那种），用它当基准会让整张网格偏掉。
 */
function gridOrigin(positions, cell) {
  return {
    x: commonResidue(positions.map((point) => point.x), cell.width),
    y: commonResidue(positions.map((point) => point.y), cell.height)
  };
}

function commonResidue(values, size) {
  if (values.length === 0) return 0;
  const counts = new Map();
  for (const value of values) {
    const residue = ((value % size) + size) % size;
    counts.set(residue, (counts.get(residue) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [residue, count] of counts) {
    if (count > bestCount || (count === bestCount && residue < best)) {
      best = residue;
      bestCount = count;
    }
  }
  return best;
}

/** 哪些格子被图标占了，用 `列,行` 表示。 */
function occupiedCells(positions, cell, origin) {
  const taken = new Set();
  for (const point of positions) {
    taken.add(`${cellOf(point.x, cell.width, origin.x)},${cellOf(point.y, cell.height, origin.y)}`);
  }
  return taken;
}

function cellOf(value, size, origin) {
  return Math.round((value - origin) / size);
}

/** 把矩形吸附到整数格上：位置取最近的格线，尺寸取最近的整数格。 */
function snapToCell(bounds, cell, origin) {
  const columns = Math.max(1, Math.round(bounds.width / cell.width));
  const rows = Math.max(1, Math.round(bounds.height / cell.height));
  return {
    x: origin.x + cellOf(bounds.x, cell.width, origin.x) * cell.width,
    y: origin.y + cellOf(bounds.y, cell.height, origin.y) * cell.height,
    width: columns * cell.width,
    height: rows * cell.height
  };
}

/**
 * 给窗口定一个位置：吸附到网格，避开图标，必要时缩到能放得下的整数格。
 *
 * 顺序是：
 *   1. 先按现在的大小找最近的空格子 —— 能不动就不动。
 *   2. 找不到（桌面被图标占满，或者窗口比空缺的地方还高）就**一格格减行**再找。
 *      真实场景：1080p 桌面上图标铺满上面 5 行，下面只剩 500px，而窗口有 610px 高 ——
 *      不减行的话它永远只能压在图标上。宽度不动，只减高度。
 *
 * @param {object} input
 * @param {{x:number,y:number,width:number,height:number}} input.bounds 想要的位置和大小。
 * @param {{width:number,height:number}} input.cell 格子尺寸。
 * @param {{x:number,y:number}} input.origin 网格原点。
 * @param {Array<{x:number,y:number}>} input.positions 图标位置。
 * @param {{width:number,height:number}} input.screen 可用区域（要排除任务栏）。
 * @param {number} [input.minimumRows] 最少保留几行，防止缩成一个条。
 * @returns {{x,y,width,height}|null} 实在放不下就返回 null，调用方保持原样。
 */
function planBounds({ bounds, cell, origin, positions, screen, minimumRows = 3 }) {
  // 先吸附：位置取最近格线、尺寸取整数格。下面全在格子坐标里算。
  const snapped = snapToCell(bounds, cell, origin);
  const taken = occupiedCells(positions, cell, origin);
  const columns = Math.max(1, Math.round(snapped.width / cell.width));
  const wantedColumn = cellOf(snapped.x, cell.width, origin.x);
  const wantedRow = cellOf(snapped.y, cell.height, origin.y);

  const tallest = Math.max(1, Math.round(snapped.height / cell.height));
  for (let rows = tallest; rows >= Math.max(1, minimumRows); rows -= 1) {
    const slot = nearestFreeSlot({ columns, rows, wantedColumn, wantedRow, taken, cell, origin, screen });
    if (slot === null) continue;
    return {
      x: origin.x + slot.column * cell.width,
      y: origin.y + slot.row * cell.height,
      width: columns * cell.width,
      height: rows * cell.height
    };
  }
  return null;
}

/**
 * 最近的空格子。按行优先扫描，同距离取更靠上、更靠左的，结果是确定的。
 *
 * `screen` 是一块屏的可用区域 `{ x, y, width, height }`，坐标是屏幕坐标。
 * 网格原点可能不在 (0,0)，屏也可能在负坐标上（副屏放在主屏左边时就是这样），
 * 所以先把它换算成格子编号，再按格子扫。
 */
function nearestFreeSlot({ columns, rows, wantedColumn, wantedRow, taken, cell, origin, screen }) {
  const firstColumn = Math.ceil((screen.x - origin.x) / cell.width);
  const firstRow = Math.ceil((screen.y - origin.y) / cell.height);
  const lastColumn = Math.floor((screen.x + screen.width - origin.x) / cell.width) - columns;
  const lastRow = Math.floor((screen.y + screen.height - origin.y) / cell.height) - rows;
  if (lastColumn < firstColumn || lastRow < firstRow) return null;

  function isFree(column, row) {
    if (column < firstColumn || row < firstRow || column > lastColumn || row > lastRow) return false;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        if (taken.has(`${column + c},${row + r}`)) return false;
      }
    }
    return true;
  }

  let best = null;
  let bestDistance = Infinity;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (!isFree(column, row)) continue;
      const distance = Math.abs(column - wantedColumn) + Math.abs(row - wantedRow);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { column, row };
      }
    }
  }
  return best;
}

module.exports = { gridOrigin, occupiedCells, planBounds, snapToCell };
