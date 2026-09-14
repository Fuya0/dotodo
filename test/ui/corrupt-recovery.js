/*
 * 主状态文件损坏、备份完好时，界面应该是什么样。
 *
 * 关键的界面承诺：**必须告诉用户"出过事、证据在哪"**，而不是默默从备份恢复、
 * 让用户以为一切正常。所以警告条要出现，而且里面要有恢复文件的绝对路径。
 */

const band = q('#runtimeWarning');

await expect('启动时出现了警告条', () => !band.hidden);
const warningText = (band.textContent ?? '').trim();

check('警告说明主文件已损坏', warningText.includes('损坏'), warningText);
check('警告说明已从备份恢复', warningText.includes('备份'), warningText);
check('警告里带有恢复文件的绝对路径', /recovery-primary-[^\s]*\.json/.test(warningText), warningText);
check('警告里的路径是绝对路径', /[A-Za-z]:\\/.test(warningText), warningText);
check('提示条没有占满屏幕',
  band.getBoundingClientRect().height <= window.innerHeight * 0.2,
  `${Math.round(band.getBoundingClientRect().height)}px / 窗口 ${window.innerHeight}px`);

/* ---------- 数据确实回来了，应用照常能用 ---------- */

await expect('清单从备份恢复出来了', () => rows().length === 9, () => `${rows().length} 行`);
check('进度标签反映了恢复的数据', /^\d+ \/ 9$/.test(text('#progressLabel') ?? ''), text('#progressLabel'));

const before = rows().length;
q('#todoInput').value = '恢复之后还能正常添加';
q('#todoForm').requestSubmit();
await expect('恢复之后仍然可以添加任务', () => rows().length === before + 1, () => `${rows().length} 行`);

check('没有出现第二个错误提示', qa('.error-area:not([hidden])').length === 0,
  qa('.error-area').map((n) => n.textContent).join(' / '));

return results;
