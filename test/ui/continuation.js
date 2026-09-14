/*
 * 把一条未完成的历史任务延续到今天。
 *
 * 这是「历史只读 + 延续」这套产品规则的端到端验证：历史行本身不能被改写，
 * 延续产生的是今天的新任务，两边通过元数据互相指向，而且终身只能延续一次。
 */

q('.tab[data-page="history"]').click();
await expect('切到历史页', () => !q('#historyPage').hidden);

const continueButtons = () => qa('.history-row .text-button');
const todayCount = () => {
  const label = text('#progressLabel') ?? '0 / 0';
  return Number((label.split('/')[1] ?? '0').trim());
};

check('历史里恰好一个延续入口', continueButtons().length === 1, `实际 ${continueButtons().length}`);
const sourceRow = continueButtons()[0].closest('.history-row');
check('延续入口出现在未完成的那一行',
  !sourceRow.classList.contains('completed'));
check('有延续入口的行没有状态标签', sourceRow.querySelector('.history-status').hidden);

// 记住历史页的原始内容，稍后确认它没被改写。
const originalHistoryTexts = qa('.history-row .todo-text').map((node) => node.textContent);
const originalHistoryCompletion = qa('.history-row').map((row) => row.classList.contains('completed'));

continueButtons()[0].click();
await expect('延续之后入口消失', () => continueButtons().length === 0);
check('未完成的那一行出现「已延续到」状态',
  qa('.history-row .history-status').some((node) => (node.textContent ?? '').includes('已延续到')),
  qa('.history-row .history-status').map((n) => n.textContent).join(' / '));
check('历史行的文字没有被改写',
  qa('.history-row .todo-text').map((node) => node.textContent).join('|') === originalHistoryTexts.join('|'));
check('历史行的完成状态没有被改写',
  qa('.history-row').map((row) => row.classList.contains('completed')).join(',') === originalHistoryCompletion.join(','));

q('.tab[data-page="today"]').click();
await expect('切回今天页', () => !q('#todayPage').hidden);
check('今天多了一条任务', todayCount() === 10, `实际 ${todayCount()}`);
check('延续过来的任务在列表底部', rowTexts().at(-1) === '给客户回邮件', rowTexts().at(-1));
check('延续过来的任务是未完成的', !rows().at(-1).classList.contains('completed'));

// 「终身最多延续一次」：把它删掉，历史里的入口也不该回来。
press(rows().at(-1), 'Delete');
await expect('删掉延续出来的任务', () => todayCount() === 9, `实际 ${todayCount()}`);
q('.tab[data-page="history"]').click();
await expect('回到历史页', () => !q('#historyPage').hidden);
check('删掉目标之后，延续入口没有重新出现', continueButtons().length === 0,
  `实际 ${continueButtons().length} 个`);

// 状态标签会从「已延续到 X月X日」退化成「已延续过」：删掉目标时，双向链接被清空，
// 连带着 continuedToDate 也没了，所以界面不再知道它延续到了哪一天。
// 但 hasBeenContinued 保留着——这就是「终身最多延续一次」能生效的原因。
check('来源行仍然显示「已延续过」，而不是重新变成可延续',
  qa('.history-row .history-status').some((node) => (node.textContent ?? '').includes('已延续过')),
  qa('.history-row .history-status').map((n) => n.textContent).join(' / '));

return results;
