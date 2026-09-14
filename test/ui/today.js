/*
 * 今日清单的交互：添加、勾选、编辑、键盘、删除撤销、排序。
 * 这些行为在验收清单里原本只能靠肉眼，这里让它们可以被自动重放。
 */

const input = q('#todoInput');
const form = q('#todoForm');
const startCount = rows().length;

check('演示数据已经渲染出来', startCount > 0, `实际 ${startCount} 行`);
check('标题栏没有出现提示条', q('#runtimeWarning').hidden);

/* ---------- 添加 ---------- */

input.value = '写周报';
form.requestSubmit();
await expect('添加后列表多一行', () => rows().length === startCount + 1);
check('新任务出现在列表底部', rowTexts().at(-1) === '写周报', rowTexts().at(-1));
check('添加后输入框被清空', input.value === '');

const addedRow = rows().at(-1);
const progressAfterAdd = text('#progressLabel');

/* ---------- 勾选 ---------- */

addedRow.querySelector('.check-button').click();
await expect('勾选后该行标记为完成', () => rows().at(-1).classList.contains('completed'));
check('勾选后进度标签变化', text('#progressLabel') !== progressAfterAdd,
  `添加后 ${progressAfterAdd}，勾选后 ${text('#progressLabel')}`);
check('完成项的勾选框带 aria-pressed', rows().at(-1).querySelector('.check-button').getAttribute('aria-pressed') === 'true');

/* ---------- 双击编辑：提交 ---------- */

rows()[0].querySelector('.todo-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
await expect('双击进入行内编辑', () => Boolean(rows()[0].querySelector('.edit-input')));

const editor = rows()[0].querySelector('.edit-input');
const originalText = editor.value;
editor.value = '改过的内容';
press(editor, 'Enter');
await expect('Enter 提交编辑', () => rowTexts()[0] === '改过的内容', () => rowTexts()[0]);

/* ---------- 双击编辑：取消 ---------- */

rows()[0].querySelector('.todo-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
await expect('再次进入编辑', () => Boolean(rows()[0].querySelector('.edit-input')));
const cancelEditor = rows()[0].querySelector('.edit-input');
cancelEditor.value = '这段不该被保存';
press(cancelEditor, 'Escape');
await expect('Escape 放弃修改', () => !rows()[0].querySelector('.edit-input'));
check('取消后原文不变', rowTexts()[0] === '改过的内容', rowTexts()[0]);
check('原始内容确实被记住了', originalText.length > 0);

/* ---------- 键盘操作 ---------- */

const firstRow = rows()[0];
const wasCompleted = firstRow.classList.contains('completed');
press(firstRow, ' ');
await expect('Space 切换完成状态', () => rows()[0].classList.contains('completed') !== wasCompleted);
press(rows()[0], ' ');

press(rows()[0], 'F2');
await expect('F2 进入编辑', () => Boolean(rows()[0].querySelector('.edit-input')));
press(rows()[0].querySelector('.edit-input'), 'Escape');
await expect('Escape 退出编辑', () => !rows()[0].querySelector('.edit-input'));

/* ---------- 排序 ---------- */

const beforeReorder = rowTexts().slice(0, 3);
press(rows()[0], 'ArrowDown', { altKey: true });
await expect('Alt+↓ 把第一行下移一位',
  () => rowTexts()[0] === beforeReorder[1] && rowTexts()[1] === beforeReorder[0],
  () => rowTexts().slice(0, 3).join(' | '));

/* ---------- 删除与撤销 ---------- */

const beforeDelete = rowTexts();
const countBeforeDelete = rows().length;
press(rows()[0], 'Delete');
await expect('Delete 删除当前行', () => rows().length === countBeforeDelete - 1);
check('删掉的是当前第一行', rowTexts()[0] === beforeDelete[1], rowTexts()[0]);

await expect('撤销条出现', () => !q('#undoBar').hidden);
check('撤销条自带倒计时动画',
  getComputedStyle(q('#undoProgress')).animationName === 'undo-countdown',
  getComputedStyle(q('#undoProgress')).animationName);

q('#undoButton').click();
await expect('撤销后任务恢复', () => rows().length === countBeforeDelete);
check('撤销后回到原来的位置', rowTexts()[0] === beforeDelete[0], rowTexts()[0]);
await expect('撤销条消失', () => q('#undoBar').hidden);

/* ---------- 界面上不该出现的东西 ---------- */

check('任务行上没有「延续」角标', qa('.continue-badge').length === 0);
check('底部没有快捷键提示', q('.tab-hint') === null);
check('输入框的 maxlength 是 240', input.getAttribute('maxlength') === '240');

return results;
