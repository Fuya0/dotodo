/*
 * 磁盘写不进去时，界面必须诚实。
 *
 * 最危险的失败不是"报错"，而是"看起来一切正常，其实什么都没存"。
 * 所以这里要同时看到：当场报错、任务仍留在界面上、以及一条**不会自己消失**的提示。
 */

const startCount = rows().length;

q('#todoInput').value = '写不进磁盘的任务';
q('#todoForm').requestSubmit();

/* ---------- 1. 当场报错 ---------- */

await expect('出现保存失败提示', () => {
  const area = q('#errorArea');
  return !area.hidden && (area.textContent ?? '').includes('保存失败');
}, () => q('#errorArea').textContent);

check('提示里带着具体原因', /EPERM|无法安全写入|拒绝访问/.test(q('#errorArea').textContent ?? ''),
  q('#errorArea').textContent);
check('错误提示用错误配色（不是信息色）', !q('#errorArea').classList.contains('is-info'));

/* ---------- 2. 用户刚打的字不能被吞掉 ---------- */

await expect('新任务仍然留在界面上', () => rows().length === startCount + 1,
  () => `${rows().length} 行`);
check('新任务在列表底部', rowTexts().at(-1) === '写不进磁盘的任务', rowTexts().at(-1));

// 任务已经在列表里了，输入框就不能再留着同一句话——否则用户再按一次回车
// 会得到两条一模一样的任务。区分「引擎拒绝」和「只是没存下去」靠的是 applied 标志。
check('任务进列表之后输入框被清空（避免重复添加）', q('#todoInput').value === '',
  JSON.stringify(q('#todoInput').value));

q('#todoForm').requestSubmit();
await sleep(200);
check('再按一次回车不会重复添加（输入框是空的）', rows().length === startCount + 1,
  `${rows().length} 行`);

/* ---------- 3. 还要有一条不会自己消失的提示 ---------- */

await expect('出现持久的运行期提示', () => !q('#runtimeWarning').hidden, () => '提示条没出现');
const warningText = (q('#runtimeWarning').textContent ?? '').trim();
check('提示说明数据只在内存里', warningText.includes('内存'), warningText);
check('提示条不遮挡标题',
  q('#runtimeWarning').getBoundingClientRect().bottom <=
    q('#todayPage .hero h1').getBoundingClientRect().top + 1);

/* ---------- 4. 关掉错误条之后，持久提示仍然在 ---------- */

// 错误条 6 秒后自己消失，但"数据没存下去"这件事不能跟着消失。
q('#errorArea').hidden = true;
await sleep(50);
check('错误条消失后，持久提示还在', !q('#runtimeWarning').hidden);

/* ---------- 5. 应用不能因为存不下去就罢工 ---------- */

check('输入框仍然可用', !q('#todoInput').disabled);
check('标题栏仍然在（窗口没有崩）', q('.titlebar') !== null);

return results;
