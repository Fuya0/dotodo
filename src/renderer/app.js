/*
 * 渲染进程入口：只做三件事——把快照画成 DOM、把用户输入变成命令、用返回的快照重画。
 *
 * 这里不读写文件、不碰 Node、不知道数据存在哪里。所有可信状态都留在主进程，
 * 页面只能通过 window.dotodo 这一组固定方法请求变更。
 */

'use strict';

// 对勾的纵向下移半格：原来三点是 (3,8)/(6,11)/(13,4)，纵向跨度 4..11，
// 中心落在 7.5，而 16x16 的 viewBox 中心是 8 —— 于是对勾在圆圈里偏高。
// 改成 8.5 之后跨度 4.5..11.5，中心正好 8。test/renderer/icon-geometry.test.js
// 会从这段路径数据里算几何中心，偏了就红。
const CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>';
const DELETE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m2 0-.5 10h-7L6 6m3 3v4m2-4v4" /></svg>';
const DRAG_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h4M6 8h4M6 12h4" /></svg>';

const UNDO_VISIBLE_MS = 6000;
const MESSAGE_VISIBLE_MS = 6000;

const dom = {
  warning: document.querySelector('#runtimeWarning'),
  todayPage: document.querySelector('#todayPage'),
  historyPage: document.querySelector('#historyPage'),
  dateLabel: document.querySelector('#dateLabel'),
  progressLabel: document.querySelector('#progressLabel'),
  progressTrack: document.querySelector('#progressTrack'),
  progressBar: document.querySelector('#progressBar'),
  form: document.querySelector('#todoForm'),
  input: document.querySelector('#todoInput'),
  errorArea: document.querySelector('#errorArea'),
  list: document.querySelector('#todoList'),
  emptyState: document.querySelector('#emptyState'),
  emptyTitle: document.querySelector('#emptyTitle'),
  emptyCopy: document.querySelector('#emptyCopy'),
  historyCount: document.querySelector('#historyCount'),
  historyList: document.querySelector('#historyList'),
  historyEmpty: document.querySelector('#historyEmpty'),
  historyEmptyTitle: document.querySelector('#historyEmptyTitle'),
  historyEmptyCopy: document.querySelector('#historyEmptyCopy'),
  tabs: [...document.querySelectorAll('.tab')],
  undoBar: document.querySelector('#undoBar'),
  undoProgress: document.querySelector('#undoProgress'),
  undoText: document.querySelector('#undoText'),
  undoButton: document.querySelector('#undoButton'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
  settingsCloseButton: document.querySelector('#settingsCloseButton'),
  closeToTrayToggle: document.querySelector('#closeToTrayToggle'),
  launchAtLoginToggle: document.querySelector('#launchAtLoginToggle'),
  importButton: document.querySelector('#importButton'),
  exportButton: document.querySelector('#exportButton'),
  openFolderButton: document.querySelector('#openFolderButton'),
  minimizeButton: document.querySelector('#minimizeButton'),
  closeButton: document.querySelector('#closeButton')
};

const state = {
  snapshot: null,
  page: 'today',
  editingId: null,
  undoToken: null,
  undoTimer: null,
  messageTimer: null,
  drop: null
};

/* ---------- 与主进程通信 ---------- */

/**
 * 运行一条命令，并用主进程返回的快照重画界面。
 * 主进程的约定：{ ok: true, snapshot } / { ok: false, error, snapshot } / { ok: false, cancelled: true }。
 */
async function runCommand(promise) {
  let result;
  try {
    result = await promise;
  } catch (error) {
    showMessage(`操作失败：${describeError(error)}`);
    return null;
  }
  if (!result || result.cancelled) return null;
  if (result.ok === false) showMessage(result.error);
  if (result.snapshot) applySnapshot(result.snapshot);
  return result;
}

function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  render();
  // 运行期状态（保存失败、只存在内存里、数据损坏）是主进程算的，启动时只取过一次。
  // 每次应用快照顺手刷新一次，用户才会在出问题之后看到那条持久提示——
  // 否则错误条 6 秒后消失，用户会以为一切正常，继续往一个存不下去的清单里加东西。
  refreshStatus();
}

/* ---------- 渲染 ---------- */

function render() {
  if (!state.snapshot) return;
  const settings = deriveSettingsView(state.snapshot);
  renderSettings(settings);
  renderToday(deriveTodayView(state.snapshot));
  renderHistory(deriveHistoryView(state.snapshot));
  renderPage();
}

function renderSettings(settings) {
  dom.closeToTrayToggle.checked = settings.closeToTray;
  dom.launchAtLoginToggle.checked = settings.launchAtLogin;}

/* ---------- Today ---------- */

function renderToday(view) {
  const focusedId = document.activeElement?.closest?.('.todo-row')?.dataset.id ?? null;

  dom.dateLabel.textContent = view.dateLabel;
  dom.progressLabel.textContent = view.progressLabel;
  dom.progressBar.style.width = `${view.progressPercent}%`;
  dom.progressTrack.setAttribute('aria-valuenow', String(view.progressPercent));

  dom.emptyState.hidden = !view.isEmpty;
  dom.list.hidden = view.isEmpty;
  if (view.empty) {
    dom.emptyTitle.textContent = view.empty.title;
    dom.emptyCopy.textContent = view.empty.copy;
  }

  dom.list.replaceChildren(...view.tasks.map(createRow));

  if (focusedId) {
    const restored = findRow(focusedId);
    if (restored) restored.focus({ preventScroll: true });
  }
}

function createRow(row, index) {
  const item = document.createElement('div');
  item.className = `todo-row${row.completed ? ' completed' : ''}`;
  item.dataset.id = row.id;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', 'false');
  item.tabIndex = index === 0 ? 0 : -1;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.tabIndex = -1;
  handle.setAttribute('aria-label', `拖动排序：${row.text}（也可以用 Alt + 方向键）`);
  handle.innerHTML = DRAG_ICON;
  handle.addEventListener('pointerdown', (event) => beginDrag(event, row.id));

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check-button';
  check.setAttribute('aria-pressed', String(row.completed));
  check.setAttribute('aria-label', row.completed ? `标记为未完成：${row.text}` : `标记为已完成：${row.text}`);
  check.innerHTML = CHECK_ICON;
  check.addEventListener('click', () => toggleTask(row.id));

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = row.text;
  text.title = row.text;
  text.addEventListener('dblclick', () => beginEdit(row.id));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.setAttribute('aria-label', `删除：${row.text}`);
  remove.innerHTML = DELETE_ICON;
  remove.addEventListener('click', () => deleteTodayTask(row.id));

  item.append(handle, check, text, remove);
  return item;
}

/* ---------- History ---------- */

function renderHistory(view) {
  dom.historyCount.textContent = `${view.dayCount} 天`;
  dom.historyList.hidden = view.isEmpty;
  dom.historyEmpty.hidden = !view.isEmpty;
  if (view.empty) {
    dom.historyEmptyTitle.textContent = view.empty.title;
    dom.historyEmptyCopy.textContent = view.empty.copy;
  }
  dom.historyList.replaceChildren(...view.days.map(createHistoryDay));
}

function createHistoryDay(day) {
  const section = document.createElement('section');
  section.className = 'history-day';

  const head = document.createElement('header');
  head.className = 'history-head';
  const title = document.createElement('h2');
  title.textContent = day.dateLabel;
  const count = document.createElement('span');
  count.className = 'progress-label';
  count.textContent = day.progressLabel;
  head.append(title, count);

  // 这个 div 只是给 replaceChildren 一个容器，没有对应样式，所以不挂类名。
  const list = document.createElement('div');
  list.replaceChildren(...day.tasks.map((row) => createHistoryRow(row, day.date)));

  section.append(head, list);
  return section;
}

/** 历史行是只读的：没有编辑、没有勾选，只留下删除和延续两个动作。 */
function createHistoryRow(row, date) {
  const item = document.createElement('div');
  item.className = `history-row${row.completed ? ' completed' : ''}`;
  item.dataset.id = row.id;

  const marker = document.createElement('span');
  marker.className = 'check-indicator';
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = CHECK_ICON;

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = row.text;
  text.title = row.text;

  const status = document.createElement('span');
  status.className = 'history-status';
  status.textContent = row.statusLabel ?? '';
  status.hidden = !row.statusLabel;

  const actions = document.createElement('span');
  actions.className = 'history-actions';

  if (row.canContinue) {
    const carry = document.createElement('button');
    carry.type = 'button';
    carry.className = 'text-button';
    carry.textContent = '延续到今天';
    carry.setAttribute('aria-label', `延续到今天：${row.text}`);
    carry.addEventListener('click', () => continueTask(date, row.id));
    actions.append(carry);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button is-visible';
  remove.setAttribute('aria-label', `删除历史任务：${row.text}`);
  remove.innerHTML = DELETE_ICON;
  remove.addEventListener('click', () => deleteHistoryTask(date, row.id));
  actions.append(remove);

  item.append(marker, text, status, actions);
  return item;
}

/* ---------- 命令 ---------- */

const addTask = (text) => runCommand(window.dotodo.addTask(text));
const toggleTask = (id) => runCommand(window.dotodo.toggleTask(id));
const editTask = (id, text) => runCommand(window.dotodo.editTask(id, text));

async function deleteTodayTask(id) {
  const result = await runCommand(window.dotodo.deleteTodayTask(id));
  if (result && result.ok && result.undoToken) {
    state.undoToken = result.undoToken;
    showUndoBar('已删除一项任务。');
  }
}

async function deleteHistoryTask(date, id) {
  const result = await runCommand(window.dotodo.deleteHistoryTask(date, id));
  if (result && result.ok && result.undoToken) {
    state.undoToken = result.undoToken;
    showUndoBar('已删除一项历史任务。');
  }
}

const continueTask = (date, id) => runCommand(window.dotodo.continueTask(date, id));

async function undoLastDelete() {
  const token = state.undoToken;
  hideUndoBar();
  if (!token) return;
  await runCommand(window.dotodo.undo(token));
}

/* ---------- 行内编辑 ---------- */

function beginEdit(id) {
  if (state.editingId !== null) return;
  const item = findRow(id);
  const text = item?.querySelector('.todo-text');
  if (!item || !text) return;

  const original = text.textContent;
  const input = document.createElement('input');
  input.className = 'edit-input';
  input.maxLength = 240;
  input.value = original;
  input.setAttribute('aria-label', '编辑任务');
  text.replaceWith(input);

  state.editingId = id;
  input.focus();
  input.select();

  let settled = false;
  const finish = async (commit) => {
    if (settled) return;
    settled = true;
    state.editingId = null;
    const value = input.value.trim();
    if (commit && value && value !== original) {
      await editTask(id, value);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

/* ---------- 列表键盘行为 ---------- */

dom.list.addEventListener('keydown', (event) => {
  if (event.target.classList.contains('edit-input')) return;
  const item = event.target.closest('.todo-row');
  if (!item) return;
  const id = item.dataset.id;

  if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    // 纯键盘的排序入口：拖拽对键盘用户不可用，必须另留一条路。
    event.preventDefault();
    moveTaskByKeyboard(item, event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === ' ') {
    event.preventDefault();
    toggleTask(id);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteTodayTask(id);
  } else if (event.key === 'F2') {
    event.preventDefault();
    beginEdit(id);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(item, event.key === 'ArrowDown' ? 1 : -1);
  }
});

/** 列表框用「游标式 tabindex」：只有当前行能被 Tab 命中，方向键在行之间移动。 */
dom.list.addEventListener('focusin', (event) => {
  const item = event.target.closest('.todo-row');
  if (!item) return;
  for (const row of rowsOf()) {
    row.tabIndex = row === item ? 0 : -1;
    row.setAttribute('aria-selected', String(row === item));
  }
});

dom.list.addEventListener('focusout', (event) => {
  const item = event.target.closest('.todo-row');
  if (item) item.setAttribute('aria-selected', 'false');
});

function moveFocus(item, delta) {
  const rows = rowsOf();
  const next = rows[rows.indexOf(item) + delta];
  if (next) next.focus();
}

function moveTaskByKeyboard(item, delta) {
  const rows = rowsOf();
  const from = rows.indexOf(item);
  const target = from + delta;
  if (target < 0 || target >= rows.length) return;
  // reorderTask 的目标下标是「移除被拖行之后」的位置，正好等于 from + delta。
  runCommand(window.dotodo.reorderTask(item.dataset.id, target));
}

/* ---------- 指针拖拽排序 ---------- */

function beginDrag(event, id) {
  if (event.button !== 0 || state.drop) return;
  const row = findRow(id);
  if (!row) return;
  event.preventDefault();

  state.drop = {
    id,
    row,
    fromIndex: rowsOf().indexOf(row),
    targetIndex: rowsOf().indexOf(row),
    pointerId: event.pointerId
  };
  row.classList.add('dragging');

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', cancelDrag);
  dom.list.addEventListener('pointerleave', cancelDrag);
}

function onDragMove(event) {
  const drop = state.drop;
  if (!drop || event.pointerId !== drop.pointerId) return;

  // 落点是相对「已经拿走被拖行之后」的列表算的，所以要从候选里排除它自己。
  const others = rowsOf().filter((row) => row !== drop.row);
  const bounds = others.map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });

  const outcome = resolveDropIndex(bounds, event.clientY, drop.fromIndex);
  if (outcome.targetIndex === drop.targetIndex) return;

  drop.targetIndex = outcome.targetIndex;
  clearDropMarker();

  // 往哪边拖，落点线就画在目标行的哪一边。
  const marker = others[outcome.markerIndex];
  if (marker && outcome.side) {
    marker.classList.add('drag-over', outcome.side === 'before' ? 'drag-over-before' : 'drag-over-after');
  }
}

async function endDrag(event) {
  const drop = state.drop;
  if (!drop || (event && event.pointerId !== drop.pointerId)) return;
  const { id, fromIndex, targetIndex } = drop;
  cleanupDrag();
  if (targetIndex >= 0 && targetIndex !== fromIndex) {
    await runCommand(window.dotodo.reorderTask(id, targetIndex));
  }
}

function cancelDrag() {
  cleanupDrag();
}

function cleanupDrag() {
  const drop = state.drop;
  if (!drop) return;
  drop.row.classList.remove('dragging');
  clearDropMarker();
  state.drop = null;

  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', cancelDrag);
  window.removeEventListener('blur', cancelDrag);
  dom.list.removeEventListener('pointerleave', cancelDrag);
}

function clearDropMarker() {
  for (const row of dom.list.querySelectorAll('.drag-over')) {
    row.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
  }
}

function rowsOf() {
  return [...dom.list.querySelectorAll('.todo-row')];
}

/* ---------- 表单与快捷键 ---------- */

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = dom.input.value.trim();
  if (!value) return;
  const result = await addTask(value);
  // 清空输入框的判据是「这条任务已经进列表了」，而不是「一切顺利」：
  // 落盘失败时任务仍在列表上（`applied`），这时留着原文只会让用户再添一条重复的。
  if (result && (result.ok || result.applied)) dom.input.value = '';
  dom.input.focus();
});

for (const tab of dom.tabs) {
  tab.addEventListener('click', () => {
    state.page = tab.dataset.page;
    renderPage();
  });
}

function renderPage() {
  const isHistory = state.page === 'history';
  dom.todayPage.hidden = isHistory;
  dom.historyPage.hidden = !isHistory;
  for (const tab of dom.tabs) {
    const active = tab.dataset.page === state.page;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    setSettingsOpen(false);
    if (state.page !== 'today') {
      state.page = 'today';
      renderPage();
    }
    dom.input.focus();
    dom.input.select();
    return;
  }
  if (event.key === 'Escape' && isSettingsOpen()) {
    setSettingsOpen(false);
    dom.settingsButton.focus();
  }
});

/* ---------- 设置：原生开关 ---------- */

dom.closeToTrayToggle.addEventListener('change', (event) => {
  runCommand(window.dotodo.setCloseToTray(event.target.checked));
});

dom.launchAtLoginToggle.addEventListener('change', (event) => {
  runCommand(window.dotodo.setLaunchAtLogin(event.target.checked));
});

dom.minimizeButton.addEventListener('click', () => window.dotodo.minimizeWindow());
dom.closeButton.addEventListener('click', () => window.dotodo.closeWindow());

/* ---------- 数据导入导出 ---------- */

dom.importButton.addEventListener('click', async () => {
  const result = await runCommand(window.dotodo.importData());
  // 用户点了取消不是错误，静默返回就好。
  if (result && result.ok) showMessage('导入完成，当前清单已被导入的数据替换。', 'info');
});

dom.exportButton.addEventListener('click', async () => {
  const result = await runCommand(window.dotodo.exportData());
  if (result && result.ok && result.path) showMessage(`已导出到：${result.path}`, 'info');
});

dom.openFolderButton.addEventListener('click', () => runCommand(window.dotodo.openDataFolder()));

function isSettingsOpen() {
  return !dom.settingsPanel.hidden;
}

function setSettingsOpen(open) {
  dom.settingsPanel.hidden = !open;
  dom.settingsButton.setAttribute('aria-expanded', String(open));
}

dom.settingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setSettingsOpen(!isSettingsOpen());
});

dom.settingsCloseButton.addEventListener('click', () => {
  setSettingsOpen(false);
  dom.settingsButton.focus();
});

dom.settingsPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => setSettingsOpen(false));

/* ---------- 提示条 ---------- */

function showMessage(message, tone = 'error') {
  if (!message) return;
  dom.errorArea.textContent = message;
  dom.errorArea.classList.toggle('is-info', tone === 'info');
  dom.errorArea.hidden = false;
  clearTimeout(state.messageTimer);
  state.messageTimer = setTimeout(() => {
    dom.errorArea.hidden = true;
    state.messageTimer = null;
  }, MESSAGE_VISIBLE_MS);
}

/**
 * 六秒撤销条。可见性由渲染进程的计时器控制，令牌是否还有效由主进程的领域引擎决定——
 * 页面就算被改坏，也不可能靠过期令牌恢复任务。
 */
function showUndoBar(message) {
  dom.undoText.textContent = message;
  dom.undoBar.hidden = false;
  // 重新触发倒计时动画：直接改 animation 名字不会重播，必须先清空再强制回流。
  dom.undoProgress.style.animation = 'none';
  void dom.undoProgress.offsetWidth;
  dom.undoProgress.style.animation = '';

  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(hideUndoBar, UNDO_VISIBLE_MS);
}

function hideUndoBar() {
  clearTimeout(state.undoTimer);
  state.undoTimer = null;
  state.undoToken = null;
  dom.undoBar.hidden = true;
}

dom.undoButton.addEventListener('click', undoLastDelete);

/* ---------- 启动 ---------- */

async function refreshStatus() {
  try {
    const status = await window.dotodo.getStatus();
    const warnings = Array.isArray(status?.warnings) ? status.warnings : [];
    dom.warning.hidden = warnings.length === 0;
    dom.warning.textContent = warnings.join(' ');
  } catch {
    // 提示信息拿不到不应该挡住主界面。
  }
}

function findRow(id) {
  return dom.list.querySelector(`.todo-row[data-id="${CSS.escape(id)}"]`);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function init() {
  if (typeof deriveTodayView !== 'function') {
    showMessage('界面投影脚本没有加载，请检查 src/renderer/view-model.js。');
    return;
  }
  try {
    applySnapshot(await window.dotodo.getSnapshot());
  } catch (error) {
    showMessage(`无法读取本地数据：${describeError(error)}`);
    return;
  }
  // 托盘菜单里的设置变更不经过渲染进程，只能由主进程推快照过来同步。
  // 少了这一句，用户在托盘里切了「置顶」，设置面板会一直显示旧值。
  if (typeof window.dotodo.onSnapshot === 'function') {
    window.dotodo.onSnapshot(applySnapshot);
  }
  dom.input.focus();
  refreshStatus();
}

init();
