const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 图标画歪了很难靠肉眼发现，改起来也没有测试拦着 —— 直到有人盯着界面说"这个钩不在正中"。
// 这里把"几何居中"变成一条可算的断言：从路径数据里求出它的包围盒中心，
// 和 viewBox 的中心比。用户看到的偏移就是这么来的。

const appSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'),
  'utf8'
);

/** 取出 CHECK_ICON 的 viewBox 尺寸和 path 的顶点坐标。 */
function parseCheckIcon(source) {
  const match = source.match(
    /const CHECK_ICON = '<svg viewBox="0 0 (\d+) (\d+)"[^>]*><path d="([^"]+)"/
  );
  assert.ok(match, '没能从 app.js 里解析出 CHECK_ICON 的 viewBox 与 path');

  const width = Number(match[1]);
  const height = Number(match[2]);
  const d = match[3];

  // 这个图标用的是 "m x y  dx dy  dx dy" —— 一个 moveto 加隐式相对 lineto。
  //
  // 注意路径的写法：`m3 8.5 3 3 7-7` —— moveto 和第一个数字之间没有空格，
  // 而且 `7-7` 里负号也不带分隔符。所以不能按空白切分，得按 SVG 的词法取 token
  // （字母一个 token，数字允许带负号）。
  // 只支持这一种形式：格式变了就让解析失败，而不是悄悄算错。
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) || [];
  assert.equal(tokens[0], 'm', `CHECK_ICON 的路径以 ${tokens[0]} 开头，本解析器只认相对 moveto`);
  const numbers = tokens.slice(1).map(Number);
  assert.equal(numbers.length, 6, `期望 6 个坐标数字，实际 ${numbers.length} 个`);
  assert.ok(numbers.every(Number.isFinite), '路径里出现了非数字');

  const points = [[numbers[0], numbers[1]]];
  for (let i = 2; i < numbers.length; i += 2) {
    const [x, y] = points[points.length - 1];
    points.push([x + numbers[i], y + numbers[i + 1]]);
  }
  return { width, height, points };
}

function center(points, axis) {
  const values = points.map((point) => point[axis]);
  return (Math.min(...values) + Math.max(...values)) / 2;
}

test('CHECK_ICON 的路径确实是可解析的相对路径', () => {
  const { width, height, points } = parseCheckIcon(appSource);
  assert.equal(width, 16);
  assert.equal(height, 16);
  assert.equal(points.length, 3, '对勾是三个点的折线');
});

test('对勾在图标框里水平居中', () => {
  const { width, points } = parseCheckIcon(appSource);
  const offset = center(points, 0) - width / 2;
  assert.ok(Math.abs(offset) <= 0.01, `横向偏了 ${offset.toFixed(2)} 个单位`);
});

test('对勾在图标框里垂直居中', () => {
  // 这条曾经不成立：路径纵向跨度 4..11，中心 7.5，而框中心是 8 —— 偏上半个单位。
  // 圆圈有描边、对勾没有，所以这点偏差在界面上看起来就是"钩没在正中"。
  const { height, points } = parseCheckIcon(appSource);
  const offset = center(points, 1) - height / 2;
  assert.ok(Math.abs(offset) <= 0.01, `纵向偏了 ${offset.toFixed(2)} 个单位`);
});

test('圆圈与图标本身也是居中的（不是靠外边距硬凑）', () => {
  // 容器用 grid + place-items:center 时，内容天然居中；一旦有人改成
  // margin 或绝对定位，那套"几何中心"的推理就不再成立，这条会提醒他。
  const css = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'styles.css'),
    'utf8'
  );
  for (const selector of ['.check-button', '.check-button svg']) {
    const block = css.match(new RegExp(`\\${selector} \\{[^}]*\\}`));
    assert.ok(block, `styles.css 里找不到 ${selector} 的规则`);
    if (selector === '.check-button') {
      assert.match(block[0], /place-items:\s*center/, `${selector} 不再居中放置图标`);
    }
  }
});
