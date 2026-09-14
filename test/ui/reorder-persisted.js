/*
 * 把第一行拖到第三行，确认顺序真的变了。
 *
 * 磁盘那一侧由 reorder-persisted.case.js 检查——"界面上变了、磁盘上没变"
 * 是拖拽最典型的假成功。
 */

const before = rowTexts().slice(0, 4);
check('起始顺序就是演示数据的顺序', before[0] === '今天下午一点半开会', before.join(' | '));

const handle = rows()[0].querySelector('.drag-handle');
const target = rows()[2];
const handleRect = handle.getBoundingClientRect();
const targetRect = target.getBoundingClientRect();

handle.dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, cancelable: true, button: 0, pointerId: 21,
  clientY: handleRect.top + handleRect.height / 2
}));
window.dispatchEvent(new PointerEvent('pointermove', {
  bubbles: true, pointerId: 21, clientY: targetRect.bottom - 2
}));
window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21 }));

await expect('拖拽之后顺序变了', () => rowTexts()[0] !== before[0], () => rowTexts().slice(0, 4).join(' | '));
check('被拖的那条落到了第三位', rowTexts()[2] === before[0], rowTexts().slice(0, 4).join(' | '));
check('另外两条相应前移',
  rowTexts()[0] === before[1] && rowTexts()[1] === before[2],
  rowTexts().slice(0, 4).join(' | '));
check('拖拽没有丢掉任何任务', rows().length === 9, `${rows().length} 行`);
check('拖拽状态已经清干净', qa('.todo-row.dragging').length === 0 && qa('.todo-row.drag-over').length === 0);

return results;
