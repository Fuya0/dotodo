/*
 * 主文件和备份都损坏时，界面必须把话说清楚。
 *
 * 最糟的不是"清单空了"，而是"看起来一切正常，其实读不出数据、也存不下东西"。
 * 所以要求：警告条出现、说明两份都坏了、说明原文件保住了、应用仍然可用。
 */

const band = q('#runtimeWarning');

await expect('启动时出现了警告条', () => !band.hidden);
const warningText = (band.textContent ?? '').trim();

check('警告说明两份文件都损坏', warningText.includes('均损坏') || warningText.includes('都损坏'), warningText);
check('警告说明原文件已保留', warningText.includes('保留'), warningText);
check('警告提示用户创建新清单', warningText.includes('新') || warningText.includes('清单'), warningText);
check('警告里带有恢复文件的绝对路径', /recovery-(primary|backup)-[^\s]*\.json/.test(warningText), warningText);
check('提示条没有占满屏幕',
  band.getBoundingClientRect().height <= window.innerHeight * 0.25,
  `${Math.round(band.getBoundingClientRect().height)}px / 窗口 ${window.innerHeight}px`);

/* ---------- 应用不能因为读不出数据就罢工 ---------- */

await expect('清单是空的', () => rows().length === 0, () => `${rows().length} 行`);
check('进度归零', text('#progressLabel') === '0 / 0', text('#progressLabel'));
check('空状态出现', !q('#emptyState').hidden);
check('标题栏仍然在（窗口没有崩）', q('.titlebar') !== null);

q('#todoInput').value = '从空清单重新开始';
q('#todoForm').requestSubmit();
await expect('可以正常添加第一条任务', () => rows().length === 1, () => `${rows().length} 行`);

return results;
