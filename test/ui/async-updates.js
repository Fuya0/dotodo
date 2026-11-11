/* Real renderer handlers with a deferred command result: no Node APIs in the sandbox. */
const baseline = await window.dotodo.getSnapshot();
const copy = () => structuredClone(baseline);
const originalRunCommand = runCommand;
const input = q('#todoInput');
const form = q('#todoForm');
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let resolveCommand;
let calls = 0;
runCommand = (promise) => {
  calls += 1;
  // Drain the actual isolated IPC call; control when its result reaches the form.
  Promise.resolve(promise).catch(() => {});
  return new Promise((resolve) => { resolveCommand = resolve; });
};
input.value = '等待中的提交';
input.focus();
form.requestSubmit();
const finishFirst = resolveCommand;
form.requestSubmit();
check('同一在途提交不会重复发送', calls === 1, `命令数 ${calls}`);
input.value = '等待期间的新草稿';
q('#settingsButton').focus();
finishFirst({ ok: true });
await tick();
check('异步添加返回保留新草稿', input.value === '等待期间的新草稿', input.value);
check('异步添加返回不抢走当前焦点', document.activeElement === q('#settingsButton'));
// Settle a duplicate from the unfixed implementation too.
if (resolveCommand !== finishFirst) { resolveCommand({ ok: true }); await tick(); }
input.value = '保存失败但已应用';
form.requestSubmit();
resolveCommand({ ok: false, applied: true });
await tick();
check('已应用的提交仍清空原草稿', input.value === '');
runCommand = originalRunCommand;
applySnapshot(copy());

const firstId = baseline.activeDay.tasks[0].id;
beginEdit(firstId);
let editor = q('.edit-input');
editor.value = '尚未提交的编辑草稿';
editor.setSelectionRange(2, 7, 'backward');
applySnapshot(copy());
editor = q('.edit-input');
check('同日同任务的快照保留编辑草稿', editor?.value === '尚未提交的编辑草稿');
check('快照保留编辑焦点和选区', editor && document.activeElement === editor && editor.selectionStart === 2 && editor.selectionEnd === 7 && editor.selectionDirection === 'backward');
if (editor) press(editor, 'Escape');
// Reset the stale guard so the remaining cases independently expose their own bugs.
state.editingId = null;
applySnapshot(copy());
beginEdit(firstId);
q('.edit-input').value = '跨日未提交草稿';
const tomorrow = copy();
tomorrow.activeDay.date = baseline.activeDay.date === '2026-01-01' ? '2026-01-02' : '2026-01-01';
applySnapshot(tomorrow);
check('跨日清理编辑状态且不把同 id 编辑带到新一天', state.editingId === null && !q('.edit-input'));
check('跨日丢弃未提交编辑给出明确提示', !q('#errorArea').hidden && /草稿|未提交/.test(text('#errorArea')) && /日期|跨日|新的一天/.test(text('#errorArea')));
state.editingId = null;
applySnapshot(copy());
beginEdit(firstId);
q('.edit-input').value = '任务消失前的草稿';
q('#errorArea').hidden = true;
const removed = copy();
removed.activeDay.tasks = removed.activeDay.tasks.filter((task) => task.id !== firstId);
applySnapshot(removed);
check('任务消失清理编辑状态', state.editingId === null && !q('.edit-input'));
check('任务消失时明确提示未提交草稿', !q('#errorArea').hidden && /草稿|未提交/.test(text('#errorArea')) && /不存在|移除|删除/.test(text('#errorArea')));
state.editingId = null;
applySnapshot(copy());
rows()[0].querySelector('.drag-handle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 81 }));
check('快照测试前拖拽确实开始', state.drop !== null);
applySnapshot(copy());
check('快照更新取消在途拖拽', state.drop === null && !q('.dragging') && !q('.drag-over'));
cancelDrag();

runCommand = async (promise) => {
  await promise;
  return { ok: false, applied: true, undoToken: 'applied-delete-token' };
};
hideUndoBar();
await deleteTodayTask(firstId);
check('今日删除已应用但保存失败仍显示撤销', !q('#undoBar').hidden && state.undoToken === 'applied-delete-token');
hideUndoBar();
const historyDay = baseline.history.find((day) => day.tasks.length);
if (historyDay) {
  await deleteHistoryTask(historyDay.date, historyDay.tasks[0].id);
  check('历史删除已应用但保存失败仍显示撤销', !q('#undoBar').hidden && state.undoToken === 'applied-delete-token');
}
runCommand = originalRunCommand;
hideUndoBar();
applySnapshot(copy());
return results;
