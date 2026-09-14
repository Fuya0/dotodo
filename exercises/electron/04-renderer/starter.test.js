const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeProgress,
  toRows,
  groupByCompleted,
  nextFocusIndex,
  describeSurface,
  buildClassName,
  parseColor,
  compositeOver,
  contrastRatio
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

test('describeSurface 把颜色和 alpha 夹到合法范围并拼出 CSS 声明', () => {
  assert.deepEqual(describeSurface({ r: 28, g: 28, b: 30, alpha: 0.88 }), {
    css: 'rgba(28, 28, 30, 0.88)',
    declaration: '--surface: rgba(28, 28, 30, 0.88)'
  });
  assert.deepEqual(describeSurface({ r: 300, g: -10, b: 30.6, alpha: 0.5 }), {
    css: 'rgba(255, 0, 31, 0.55)',
    declaration: '--surface: rgba(255, 0, 31, 0.55)'
  });
  assert.deepEqual(describeSurface({ alpha: 2 }), {
    css: 'rgba(0, 0, 0, 1)',
    declaration: '--surface: rgba(0, 0, 0, 1)'
  });
});

test('describeSurface 对缺失或非法的输入返回 null', () => {
  assert.equal(describeSurface(undefined), null);
  assert.equal(describeSurface(null), null);
  assert.equal(describeSurface({ r: 28, g: 28, b: 30, alpha: Number.NaN }), null);
  assert.equal(describeSurface({ r: 28, g: 28, b: 30, alpha: '0.8' }), null);
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

/* ---------- 7. parseColor ---------- */

test('parseColor 解析 rgb() 与 rgba() 字符串', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('rgba(28, 28, 30, 0.88)'), { r: 28, g: 28, b: 30, a: 0.88 });
  assert.deepEqual(parseColor('rgba(28,28,30,0.5)'), { r: 28, g: 28, b: 30, a: 0.5 });
  assert.deepEqual(parseColor('  rgba( 1 , 2 , 3 , 0.25 )  '), { r: 1, g: 2, b: 3, a: 0.25 });
});

test('parseColor 对不认识的写法返回 null', () => {
  // 计算样式给出来的一定是 rgb()/rgba()，所以这里不需要支持十六进制。
  assert.equal(parseColor('#f5f5f7'), null);
  assert.equal(parseColor('transparent'), null);
  assert.equal(parseColor('rgb(1, 2)'), null);
  assert.equal(parseColor('rgb(a, b, c)'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor(null), null);
});

/* ---------- 8. compositeOver ---------- */

test('compositeOver 按 alpha 把前景压在背景上', () => {
  assert.deepEqual(
    compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 }),
    { r: 127.5, g: 127.5, b: 127.5, a: 1 }
  );
});

test('compositeOver 的两个极端', () => {
  const background = { r: 1, g: 2, b: 3, a: 1 };
  assert.deepEqual(compositeOver({ r: 10, g: 20, b: 30, a: 0 }, background), background);
  assert.deepEqual(
    compositeOver({ r: 10, g: 20, b: 30, a: 1 }, background),
    { r: 10, g: 20, b: 30, a: 1 }
  );
});

/* ---------- 9. contrastRatio ---------- */

test('contrastRatio 用 WCAG 相对亮度公式', () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const grey = { r: 120, g: 120, b: 120, a: 1 };

  assert.equal(Number(contrastRatio(white, black).toFixed(2)), 21);
  assert.equal(Number(contrastRatio(grey, grey).toFixed(2)), 1);
  assert.equal(Number(contrastRatio({ r: 245, g: 245, b: 247, a: 1 }, { r: 55, g: 55, b: 57, a: 1 }).toFixed(2)), 10.91);
});

test('contrastRatio 与前后顺序无关', () => {
  const a = { r: 245, g: 245, b: 247, a: 1 };
  const b = { r: 55, g: 55, b: 57, a: 1 };
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
  assert.ok(contrastRatio(a, b) > contrastRatio(a, { r: 150, g: 150, b: 150, a: 1 }));
});

test('三个函数串起来：能算出半透明文字压在底色上的对比度', () => {
  // 这就是 styles.css 里 --muted 那个真实修复的算法。
  // 面板是半透明的，最坏情况压在纯白壁纸上，合成出大约 rgb(55,55,57)；
  // rgba(235,235,245,0.6) 压上去之后约 4.74:1，刚好过 WCAG AA 的 4.5:1。
  const background = { r: 55, g: 55, b: 57, a: 1 };
  const text = compositeOver({ r: 235, g: 235, b: 245, a: 0.6 }, background);
  assert.equal(Number(contrastRatio(text, background).toFixed(2)), 4.74);
  assert.ok(contrastRatio(text, background) >= 4.5);
});
