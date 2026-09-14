/*
 * 跨日归档在界面上的结果。
 *
 * 起始存档的「今天」是昨天（见 rollover.case.js）。启动时应用应当把那一整天归档，
 * 并且**不把未完成项搬到新的一天**。这个场景只观察、不改动，
 * 因为磁盘检查是在进程退出之后跑的，中途改状态会让它读到别的东西。
 */

check('日期标签不是空的', (text('#dateLabel') ?? '').length > 0);
check('日期标签不是 Invalid Date', !(text('#dateLabel') ?? '').includes('Invalid'), text('#dateLabel'));

await expect('今天一行都没有', () => rows().length === 0, () => `实际 ${rows().length} 行`);
check('进度标签归零', text('#progressLabel') === '0 / 0', text('#progressLabel'));
await expect('空状态出现', () => !q('#emptyState').hidden);
check('正常归档不该弹警告', q('#runtimeWarning').hidden, text('#runtimeWarning'));

/* ---------- 被归档的那一天在历史页 ---------- */

q('.tab[data-page="history"]').click();
await expect('切到历史页', () => !q('#historyPage').hidden);
check('历史里正好一天', qa('.history-day').length === 1, `实际 ${qa('.history-day').length}`);
check('历史里保留了 9 条任务', qa('.history-row').length === 9, `实际 ${qa('.history-row').length}`);
check('历史分组显示完成统计', /^\d+ \/ 9$/.test(text('.history-head .progress-label') ?? ''),
  text('.history-head .progress-label'));
check('未完成的历史任务出现了延续入口', qa('.history-row .text-button').length > 0);
check('已完成的历史任务没有延续入口', qa('.history-row.completed .text-button').length === 0);

return results;
