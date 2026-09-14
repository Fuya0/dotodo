/*
 * 系统日期被调回过去时，界面应该提示而不是默默改数据。
 *
 * 起始存档的「今天」是明天（见 clock-rollback.case.js）。
 */

const band = q('#runtimeWarning');

await expect('启动时出现了时钟回拨警告', () => !band.hidden);
const warningText = (band.textContent ?? '').trim();
check('警告说明了原因', warningText.includes('系统日期早于'), warningText);
check('警告说明了应用做了什么', warningText.includes('没有回退日期') || warningText.includes('保护'), warningText);

/* ---------- 数据保持原样 ---------- */

await expect('原来的任务仍然都在', () => rows().length === 9, () => `${rows().length} 行`);
check('进度标签没有被重置', /^\d+ \/ 9$/.test(text('#progressLabel') ?? ''), text('#progressLabel'));
check('空状态没有出现', q('#emptyState').hidden);

q('.tab[data-page="history"]').click();
await expect('切到历史页', () => !q('#historyPage').hidden);
check('没有凭空多出历史', qa('.history-day').length === 0, `实际 ${qa('.history-day').length}`);
check('历史空状态文案出现', !q('#historyEmpty').hidden);

q('.tab[data-page="today"]').click();
await expect('切回今天页', () => !q('#todayPage').hidden);

/* ---------- 仍然可以正常操作 ---------- */

const before = rows().length;
q('#todoInput').value = '回拨期间也能添加';
q('#todoForm').requestSubmit();
await expect('回拨状态下仍然可以添加任务', () => rows().length === before + 1, () => `${rows().length} 行`);

return results;
