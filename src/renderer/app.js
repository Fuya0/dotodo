/*
 * 渲染进程入口：只做三件事——把快照画成 DOM、把用户输入变成命令、用返回的快照重画。
 *
 * 这里不读写文件、不碰 Node、不知道数据存在哪里。所有可信状态都留在主进程，
 * 页面只能通过 window.dotodo 这一组固定方法请求变更。
 */

'use strict';

const CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>';
const DELETE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m2 0-.5 10h-7L6 6m3 3v4m2-4v4" /></svg>';
const UNDO_VISIBLE_MS = 6000;
const MESSAGE_VISIBLE_MS = 6000;

const dom = {
  root: document.documentElement,
  warning: document.querySelector('#runtimeWarning'),
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
  undoBar: document.querySelector('#undoBar'),
  undoText: document.querySelector('#undoText'),
  undoButton: document.querySelector('#undoButton'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
  opacitySlider: document.querySelector('#opacitySlider'),
  opacityValue: document.querySelector('#opacityValue'),
  layerButton: document.querySelector('#layerButton'),
  minimizeButton: document.querySelector('#minimizeButton'),
  closeButton: document.querySelector('#closeButton')
};

const state = {
  snapshot: null,
  editingId: null,
  undoToken: null,
  undoTimer: null,
  messageTimer: null
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
  applySurfaceOpacity(snapshot.settings.backgroundOpacity);
  dom.layerButton.setAttribute('aria-pressed', String(snapshot.settings.windowMode === 'topmost'));
  render();
}

/* ---------- 渲染 ---------- */

function render() {
  if (!state.snapshot) return;
  const view = deriveTodayView(state.snapshot);
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

  const badge = document.createElement('span');
  badge.className = 'continue-badge';
  badge.textContent = '延续';
  badge.title = `延续自 ${row.continuedFromDate}`;
  badge.hidden = !row.isContinued;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.setAttribute('aria-label', `删除：${row.text}`);
  remove.innerHTML = DELETE_ICON;
  remove.addEventListener('click', () => deleteTask(row.id));

  item.append(check, text, badge, remove);
  return item;
}

/* ---------- Today 命令 ---------- */

const addTask = (text) => runCommand(window.dotodo.addTask(text));
const toggleTask = (id) => runCommand(window.dotodo.toggleTask(id));
const editTask = (id, text) => runCommand(window.dotodo.editTask(id, text));

async function deleteTask(id) {
  const result = await runCommand(window.dotodo.deleteTodayTask(id));
  if (result && result.ok && result.undoToken) {
    state.undoToken = result.undoToken;
    showUndoBar('已删除一项任务。');
  }
}

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

  if (event.key === ' ') {
    event.preventDefault();
    toggleTask(id);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteTask(id);
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
  for (const row of dom.list.querySelectorAll('.todo-row')) {
    row.tabIndex = row === item ? 0 : -1;
    row.setAttribute('aria-selected', String(row === item));
  }
});

dom.list.addEventListener('focusout', (event) => {
  const item = event.target.closest('.todo-row');
  if (item) item.setAttribute('aria-selected', 'false');
});

function moveFocus(item, delta) {
  const items = [...dom.list.querySelectorAll('.todo-row')];
  const next = items[items.indexOf(item) + delta];
  if (next) next.focus({ preventScroll: false });
}

/* ---------- 表单与快捷键 ---------- */

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = dom.input.value.trim();
  if (!value) return;
  const result = await addTask(value);
  // 只有主进程确认保存后才清空输入框，否则用户刚打的字会白白丢掉。
  if (result && result.ok) dom.input.value = '';
  dom.input.focus();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    setSettingsOpen(false);
    dom.input.focus();
    dom.input.select();
    return;
  }
  if (event.key === 'Escape' && isSettingsOpen()) {
    setSettingsOpen(false);
    dom.settingsButton.focus();
  }
});

/* ---------- 设置：背景透明度与窗口层级 ---------- */

/** 玻璃透明度只改 `--surface-opacity`，不碰整窗 opacity，也不碰文字。 */
function applySurfaceOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return;
  dom.root.style.setProperty('--surface-opacity', String(opacity));
  dom.opacitySlider.value = String(Math.round(opacity * 100));
  dom.opacityValue.value = `${Math.round(opacity * 100)}%`;
}

dom.opacitySlider.addEventListener('input', () => {
  const opacity = Number(dom.opacitySlider.value) / 100;
  dom.root.style.setProperty('--surface-opacity', String(opacity));
  dom.opacityValue.value = `${dom.opacitySlider.value}%`;
});

dom.opacitySlider.addEventListener('change', () => {
  runCommand(window.dotodo.setBackgroundOpacity(Number(dom.opacitySlider.value) / 100));
});

dom.layerButton.addEventListener('click', () => {
  const mode = state.snapshot?.settings.windowMode === 'topmost' ? 'normal' : 'topmost';
  runCommand(window.dotodo.setWindowMode(mode));
});

dom.minimizeButton.addEventListener('click', () => window.dotodo.minimizeWindow());
dom.closeButton.addEventListener('click', () => window.dotodo.closeWindow());

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

dom.settingsPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => setSettingsOpen(false));

/* ---------- 提示条 ---------- */

function showMessage(message) {
  if (!message) return;
  dom.errorArea.textContent = message;
  dom.errorArea.hidden = false;
  clearTimeout(state.messageTimer);
  state.messageTimer = setTimeout(() => {
    dom.errorArea.hidden = true;
    state.messageTimer = null;
  }, MESSAGE_VISIBLE_MS);
}

function showUndoBar(message) {
  dom.undoText.textContent = message;
  dom.undoBar.hidden = false;
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

/* ---------- 启动期提示 ---------- */

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
  dom.layerButton.setAttribute('aria-pressed', String(state.snapshot.settings.windowMode === 'topmost'));
  dom.input.focus();
  refreshStatus();
}

init();
