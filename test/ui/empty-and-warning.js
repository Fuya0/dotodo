/*
 * 两个「边界状态」的界面保证：
 *
 * 1. 清空清单后的空状态确实会出现；
 * 2. 顶部提示条出现时**不会盖住标题**——这是真出现过的缺陷：
 *    提示条以前是 position: absolute，出现时直接把「今天要做」压在下面。
 */

/* ---------- 空状态 ---------- */

check('一开始有任务，空状态是隐藏的', rows().length > 0 && q('#emptyState').hidden);

let guard = 0;
while (rows().length > 0 && guard < 30) {
  const before = rows().length;
  press(rows()[0], 'Delete');
  await waitFor(() => rows().length === before - 1, 2500);
  guard += 1;
}

check('删完之后一行都不剩', rows().length === 0, `还剩 ${rows().length} 行`);
await expect('空状态出现', () => !q('#emptyState').hidden);
check('任务列表被隐藏', q('#todoList').hidden);
check('空状态标题正确', text('#emptyTitle') === '清单空空的', text('#emptyTitle'));
check('空状态副文案正确',
  text('#emptyCopy') === '写下一件小事，然后轻松完成它。', text('#emptyCopy'));
check('进度标签归零', text('#progressLabel') === '0 / 0', text('#progressLabel'));

/* ---------- 提示条不遮挡标题 ---------- */

const band = q('#runtimeWarning');
check('提示条默认是隐藏的', band.hidden);

band.textContent = '状态文件和备份均损坏，原文件已保留，请创建新的清单。';
band.hidden = false;
await waitFor(() => !band.hidden);

const bandRect = band.getBoundingClientRect();
const headingRect = q('#todayPage .hero h1').getBoundingClientRect();
const titlebarRect = q('.titlebar').getBoundingClientRect();

check('提示条出现在标题栏下方', bandRect.top >= titlebarRect.bottom - 1,
  `提示条 top=${Math.round(bandRect.top)}，标题栏 bottom=${Math.round(titlebarRect.bottom)}`);
check('提示条不遮挡页面标题', bandRect.bottom <= headingRect.top + 1,
  `提示条 bottom=${Math.round(bandRect.bottom)}，标题 top=${Math.round(headingRect.top)}`);
check('提示条在窗口宽度内', bandRect.left >= 0 && bandRect.right <= window.innerWidth + 1,
  `left=${Math.round(bandRect.left)} right=${Math.round(bandRect.right)} 窗口宽=${window.innerWidth}`);
check('提示条有实际高度而不是 0', bandRect.height > 0, String(bandRect.height));

/* ---------- 长文案不会撑破布局 ---------- */

band.textContent = '损坏的原文件已保留在：C:\\Users\\someone\\AppData\\Roaming\\dotodo\\recovery-primary-2026-09-14T03-24-48-880Z-28608-1.json';
await sleep(50);
const longRect = band.getBoundingClientRect();
check('超长路径不会把提示条撑出窗口',
  longRect.right <= window.innerWidth + 1 && longRect.height <= 80,
  `right=${Math.round(longRect.right)} 高度=${Math.round(longRect.height)}`);

// 上面那串路径里全是连字符，浏览器本来就能在连字符处断行 —— 只测它的话，
// 把 overflow-wrap 删掉这些断言照样通过（实测过），等于什么都没验。
// 所以再换一个**没有断点的长串**。
//
// 判据不能写成「文字有没有超出内边距」。没有 overflow-wrap 时，提示条自己会被
// 内容撑宽（grid 项的默认 min-width:auto 拒绝缩到 min-content 以下），
// 文字和盒子一起变宽，内边距始终是满足的 —— 那种断言永远为真，抓不到东西。
// 实测：强制 overflow-wrap:normal 之后，提示条右边界从 383 涨到 469.6，
// 而窗口只有 390 宽 ——「文字未顶穿内边距」却依然成立。
//
// 真正能抓到的是「盒子有没有超出窗口」。
const unbroken = `损坏的原文件已保留在：C:\\Users\\someone\\${'r'.repeat(90)}.json`;
band.textContent = unbroken;
await sleep(50);
const unbrokenRect = band.getBoundingClientRect();
check('没有断点的长串不会把提示条撑出窗口',
  unbrokenRect.right <= window.innerWidth + 1,
  `提示条 right=${unbrokenRect.right.toFixed(1)}，窗口宽=${window.innerWidth}`);
check('提示条的滚动宽度不超出窗口',
  band.scrollWidth <= window.innerWidth + 1,
  `scrollWidth=${band.scrollWidth}，窗口宽=${window.innerWidth}`);

return results;
