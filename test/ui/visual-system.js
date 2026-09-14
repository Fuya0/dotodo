/*
 * 视觉系统的机器判据。
 *
 * 验收清单第 1 节的多数条目看起来只能靠眼睛：「颜色好不好看」「字清不清楚」。
 * 但其中有两件事其实是**可以算出来的**，而且正是这个项目最早暴露的问题：
 *
 *   1. 底色是不是"灰的"。之前用深蓝黑，压在彩色壁纸上会显出蓝色调，
 *      看起来像"蓝色窗口"而不是玻璃。
 *   2. 文字在最坏壁纸上还读不读得出来。面板半透明，最坏情况是压在纯白上；
 *      旧配色的 --muted 在那个底色上只有 2.8:1，远低于 WCAG AA 的 4.5:1。
 *
 * 这两条不依赖审美，所以可以钉死。剩下的（圆角好不好看、投影重不重）仍然只能人看。
 */

function parseColor(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

const toLinear = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (color) =>
  0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

/** 把半透明的前景压在已经合成好的不透明背景上。 */
const composite = (foreground, background) => ({
  r: foreground.r * foreground.a + background.r * (1 - foreground.a),
  g: foreground.g * foreground.a + background.g * (1 - foreground.a),
  b: foreground.b * foreground.a + background.b * (1 - foreground.a),
  a: 1
});

/** 面板压在某一种纯色壁纸上之后的实际底色。 */
function surfaceOver(surface, wallValue) {
  return composite(surface, { r: wallValue, g: wallValue, b: wallValue, a: 1 });
}

/** 元素文字在最坏（纯白壁纸）和最好（纯黑壁纸）两种情况下的对比度。 */
function contrastPair(element) {
  const surface = parseColor(getComputedStyle(q('.app-shell'), '::before').backgroundColor);
  const text = parseColor(getComputedStyle(element).color);
  const results = [255, 0].map((wall) => {
    const background = surfaceOver(surface, wall);
    return contrastRatio(composite(text, background), background);
  });
  return { overWhite: results[0], overBlack: results[1], worst: Math.min(...results) };
}

const AA_NORMAL_TEXT = 4.5;
const format = (value) => `${value.toFixed(2)}:1`;

/* ---------- 底色：中性、固定 ---------- */

const surface = parseColor(getComputedStyle(q('.app-shell'), '::before').backgroundColor);

check('玻璃背景有可解析的颜色', surface !== null, String(surface));
check('玻璃背景是中性的（不是蓝色底）',
  surface !== null && Math.max(surface.r, surface.g, surface.b) - Math.min(surface.r, surface.g, surface.b) <= 4,
  surface === null ? '' : `rgb(${surface.r}, ${surface.g}, ${surface.b}) 极差 ${Math.max(surface.r, surface.g, surface.b) - Math.min(surface.r, surface.g, surface.b)}`);
check('玻璃背景的 alpha 是固定值 0.88', surface !== null && Math.abs(surface.a - 0.88) < 0.001, String(surface?.a));
check('标题栏和内容区都不带整体透明度',
  getComputedStyle(q('.titlebar')).opacity === '1' && getComputedStyle(q('#todayPage')).opacity === '1');
check('外壳有圆角', parseFloat(getComputedStyle(q('.app-shell')).borderTopLeftRadius) > 0,
  getComputedStyle(q('.app-shell')).borderTopLeftRadius);

/* ---------- 文字对比度：正文与次要文字都要过 AA ---------- */

const samples = [
  ['正文（任务文字）', rows()[0].querySelector('.todo-text')],
  ['次要（应用名）', q('.brand')],
  ['弱化（进度计数）', q('#progressLabel')],
  ['已完成任务文字', qa('.todo-row.completed .todo-text')[0]]
];

for (const [label, element] of samples) {
  if (!element) {
    check(`${label}存在`, false, '演示数据里找不到这个元素');
    continue;
  }
  const ratio = contrastPair(element);
  check(`${label}在白壁纸上达到 WCAG AA`, ratio.worst >= AA_NORMAL_TEXT,
    `白底 ${format(ratio.overWhite)} / 黑底 ${format(ratio.overBlack)}，需要 ≥ ${AA_NORMAL_TEXT}:1`);
}

/* ---------- 正文本身必须完全不透明 ---------- */

const primaryText = parseColor(getComputedStyle(rows()[0].querySelector('.todo-text')).color);
check('正文文字不透明（不跟着背景一起变淡）', primaryText !== null && primaryText.a === 1, String(primaryText?.a));

const placeholder = getComputedStyle(q('#todoInput'), '::placeholder').color;
check('输入框占位符也有明确颜色', parseColor(placeholder) !== null, placeholder);

/* ---------- 外壳自己能拖动，控件区不参与拖动 ---------- */

const titlebarRegion = getComputedStyle(q('.titlebar')).webkitAppRegion;
const actionsRegion = getComputedStyle(q('.window-actions')).webkitAppRegion;
check('标题栏是可拖动区域', titlebarRegion === 'drag', titlebarRegion);
check('窗口按钮区不参与拖动', actionsRegion === 'no-drag', actionsRegion);

return results;
