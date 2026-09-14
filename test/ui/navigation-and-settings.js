/*
 * 页面切换、历史页与设置面板。
 * 顺带把「界面上不该出现的东西」钉死——降噪的成果需要有东西守着，不然下次改动会悄悄加回来。
 */

/* ---------- 底部标签 ---------- */

check('底部正好两个标签', qa('.tab').length === 2, `实际 ${qa('.tab').length}`);
check('今天标签默认选中', q('.tab[data-page="today"]').classList.contains('is-active'));
check('没有底部快捷键提示', q('.tab-hint') === null);
check('没有透明度滑杆', q('#opacitySlider') === null);
check('没有透明度数值显示', q('#opacityValue') === null);

/* ---------- 历史页 ---------- */

q('.tab[data-page="history"]').click();
await expect('切到历史页', () => !q('#historyPage').hidden && q('#todayPage').hidden);
check('历史标签变成选中态', q('.tab[data-page="history"]').classList.contains('is-active'));
check('历史标签带 aria-current',
  q('.tab[data-page="history"]').getAttribute('aria-current') === 'page');

check('历史页有日期分组', qa('.history-day').length === 1, `实际 ${qa('.history-day').length}`);
check('历史页显示天数', text('#historyCount') === '1 天', text('#historyCount'));
check('历史分组显示完成统计', /^\d+ \/ \d+$/.test(text('.history-head .progress-label') ?? ''),
  text('.history-head .progress-label'));

const historyRows = qa('.history-row');
check('历史行渲染出来了', historyRows.length === 3, `实际 ${historyRows.length}`);
check('历史行是只读的：没有勾选按钮', qa('.history-row .check-button').length === 0);
check('历史行没有双击编辑入口', qa('.history-row .edit-input').length === 0);

// 「没有编辑入口」是一种静态断言；这里再验一次行为：真的双击了也不会变成输入框。
const historyTextNode = qa('.history-row .todo-text')[0];
const historyTextBefore = historyTextNode.textContent;
historyTextNode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
await sleep(250);
check('双击历史任务不会进入编辑', qa('.history-row .edit-input').length === 0);
check('双击历史任务的文字没有被改动',
  qa('.history-row .todo-text')[0].textContent === historyTextBefore);
check('未完成的历史任务有「延续到今天」按钮', qa('.history-row .text-button').length === 1,
  `实际 ${qa('.history-row .text-button').length}`);
check('已完成的历史任务没有延续按钮', qa('.history-row.completed .text-button').length === 0);
check('历史行的删除按钮常驻可见',
  qa('.history-row .delete-button.is-visible').length === historyRows.length);

q('.tab[data-page="today"]').click();
await expect('切回今天页', () => !q('#todayPage').hidden && q('#historyPage').hidden);
check('今天标签恢复选中', q('.tab[data-page="today"]').classList.contains('is-active'));

/* ---------- 设置面板 ---------- */

q('#settingsButton').click();
await expect('设置面板打开', () => !q('#settingsPanel').hidden);
check('设置按钮 aria-expanded 为 true', q('#settingsButton').getAttribute('aria-expanded') === 'true');

const segments = qa('#windowModeGroup .segment');
check('窗口层级有三个选项', segments.length === 3, `实际 ${segments.length}`);
check('三个层级分别是普通/置顶/桌面',
  segments.map((s) => s.textContent).join(',') === '普通,置顶,桌面',
  segments.map((s) => s.textContent).join(','));
check('当前层级正好一个被选中', qa('#windowModeGroup .segment.is-active').length === 1);
check('被选中的是「置顶」', q('#windowModeGroup .segment.is-active').textContent === '置顶');

check('有「关闭时隐藏到托盘」开关', q('#closeToTrayToggle') !== null);
check('有「开机启动」开关', q('#launchAtLoginToggle') !== null);
check('有导入按钮', q('#importButton') !== null);
check('有导出按钮', q('#exportButton') !== null);
check('有打开数据目录按钮', q('#openFolderButton') !== null);

const panelLabels = qa('#settingsPanel .setting-row > span:first-child').map((s) => s.textContent);
check('设置面板里没有「背景透明度」这一项', !panelLabels.includes('背景透明度'), panelLabels.join(' / '));

q('#settingsCloseButton').click();
await expect('关闭按钮能收起设置面板', () => q('#settingsPanel').hidden);

/* ---------- 标题栏 ---------- */

check('标题栏有层级按钮', q('#layerButton') !== null);
check('标题栏有最小化按钮', q('#minimizeButton') !== null);
check('标题栏有关闭按钮', q('#closeButton') !== null);
check('层级按钮的提示语含当前层级',
  (q('#layerButton').getAttribute('aria-label') ?? '').includes('置顶'),
  q('#layerButton').getAttribute('aria-label'));

/* ---------- 历史任务可删除并撤销（验收清单 3.3） ---------- */

const historyCountBefore = qa('.history-row').length;
qa('.history-row .delete-button')[0].click();
await expect('历史任务被删除', () => qa('.history-row').length === historyCountBefore - 1,
  () => `${qa('.history-row').length} 行`);
await expect('删除历史任务后撤销条出现', () => !q('#undoBar').hidden);

q('#undoButton').click();
await expect('撤销后历史任务恢复', () => qa('.history-row').length === historyCountBefore,
  () => `${qa('.history-row').length} 行`);
check('恢复后历史行仍然是只读的', qa('.history-row .check-button').length === 0);

return results;
