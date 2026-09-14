/*
 * 最小窗口尺寸下不许出现横向溢出。
 *
 * 起始存档把窗口设成 330×420（应用允许的最小值）。悬浮小窗随时可能被缩到这么小，
 * 而"多一个按钮 / 状态标签变长 / 间距变大"都会让某一行撑破——宽窗口下看不出来。
 */

const viewportWidth = window.innerWidth;
const viewportHeight = window.innerHeight;

check('窗口确实是最小尺寸', viewportWidth <= 340 && viewportHeight <= 430,
  `${viewportWidth}×${viewportHeight}`);
check('没有横向滚动条', document.documentElement.scrollWidth <= viewportWidth + 1,
  `scrollWidth=${document.documentElement.scrollWidth} 视口=${viewportWidth}`);

/** 某个元素是不是完全落在视口里。容差 1px 吸收亚像素取整。 */
function withinViewport(element, label) {
  if (!element) {
    check(`${label}存在`, false, '找不到元素');
    return;
  }
  const rect = element.getBoundingClientRect();
  check(`${label}没有横向溢出`,
    rect.left >= -1 && rect.right <= viewportWidth + 1,
    `left=${Math.round(rect.left)} right=${Math.round(rect.right)} 视口=${viewportWidth}`);
  check(`${label}有实际尺寸`, rect.width > 0 && rect.height > 0,
    `${Math.round(rect.width)}×${Math.round(rect.height)}`);
}

withinViewport(q('.app-shell'), '外壳');
withinViewport(q('.titlebar'), '标题栏');
withinViewport(q('.todo-form'), '添加表单');
withinViewport(q('.tabs'), '底部标签');

/* ---------- 任务行：固定列 + 可省略的文本 ---------- */

const firstRow = rows()[0];
check('任务行没有横向溢出', firstRow.getBoundingClientRect().right <= viewportWidth + 1);
check('任务文字被省略而不是撑破行',
  firstRow.querySelector('.todo-text').scrollWidth > 0 &&
    firstRow.querySelector('.todo-text').getBoundingClientRect().right <= viewportWidth + 1);

/* ---------- 设置面板是浮层，必须整个落在窗口里 ---------- */

q('#settingsButton').click();
await expect('设置面板打开', () => !q('#settingsPanel').hidden);
await sleep(220); // 等入场动画走完再量尺寸

const panel = q('#settingsPanel').getBoundingClientRect();
check('设置面板没有超出右边界', panel.right <= viewportWidth + 1,
  `right=${Math.round(panel.right)} 视口=${viewportWidth}`);
check('设置面板没有超出左边界', panel.left >= -1, `left=${Math.round(panel.left)}`);
check('设置面板没有超出下边界', panel.bottom <= viewportHeight + 1,
  `bottom=${Math.round(panel.bottom)} 视口=${viewportHeight}`);
check('设置面板完整可见（没被裁掉）',
  panel.width > 180 && panel.height > 150,
  `${Math.round(panel.width)}×${Math.round(panel.height)}`);

q('#settingsCloseButton').click();
await expect('设置面板可以关闭', () => q('#settingsPanel').hidden);

/* ---------- 撤销条也是浮层 ---------- */

const before = rows().length;
press(rows()[0], 'Delete');
await expect('撤销条出现', () => !q('#undoBar').hidden);
await sleep(220);
const undo = q('#undoBar').getBoundingClientRect();
check('撤销条没有横向溢出', undo.left >= -1 && undo.right <= viewportWidth + 1,
  `left=${Math.round(undo.left)} right=${Math.round(undo.right)}`);
check('撤销条没有盖住底部标签',
  undo.bottom <= q('.tabs').getBoundingClientRect().top + 1,
  `撤销条 bottom=${Math.round(undo.bottom)} 标签 top=${Math.round(q('.tabs').getBoundingClientRect().top)}`);
q('#undoButton').click();
await expect('撤销后恢复', () => rows().length === before);

/* ---------- 历史页：行里有按钮和状态标签，最挤 ---------- */

q('.tab[data-page="history"]').click();
await expect('切到历史页', () => !q('#historyPage').hidden);

const historyRows = qa('.history-row');
check('历史行渲染出来了', historyRows.length > 0, `${historyRows.length} 行`);

const overflowing = historyRows.filter((row) => row.getBoundingClientRect().right > viewportWidth + 1);
check('历史行没有横向溢出', overflowing.length === 0,
  `${overflowing.length} 行溢出`);

const continueButton = qa('.history-row .text-button')[0];
if (continueButton) {
  const button = continueButton.getBoundingClientRect();
  check('「延续到今天」按钮完整落在窗口里', button.left >= -1 && button.right <= viewportWidth + 1,
    `left=${Math.round(button.left)} right=${Math.round(button.right)}`);
}

// 必须拿**同一行**里的文字和按钮比：延续按钮只出现在未完成那一行，
// 而它在历史里的位置不是第一行。
const rowWithButton = qa('.history-row').find((row) => row.querySelector('.text-button'));
if (rowWithButton) {
  const textRect = rowWithButton.querySelector('.todo-text').getBoundingClientRect();
  const buttonRect = rowWithButton.querySelector('.text-button').getBoundingClientRect();
  check('历史任务文字被约束在行内（不挤压按钮）', textRect.right <= buttonRect.left + 1,
    `文字 right=${Math.round(textRect.right)} 按钮 left=${Math.round(buttonRect.left)}`);
}

q('.tab[data-page="today"]').click();
await expect('切回今天页', () => !q('#todayPage').hidden);

return results;
