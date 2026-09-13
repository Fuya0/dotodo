const $ = (selector) => document.querySelector(selector);
const todoList = $('#todoList');
const emptyState = $('#emptyState');
const todoInput = $('#todoInput');
const todoForm = $('#todoForm');
const progressLabel = $('#progressLabel');
const progressBar = $('#progressBar');
const clearCompleted = $('#clearCompleted');

let todos = [];
let snapshot = null;
let currentFilter = 'all';
let editingId = null;

function acceptResult(result) {
  if (result?.snapshot) {
    snapshot = result.snapshot;
    todos = snapshot.activeDay.tasks;
    syncSettingsControls();
    render();
  }
  if (result?.ok === false && result.error) showRuntimeWarning(result.error);
  if (result?.ok === true) refreshRuntimeStatus();
  return result;
}

function showRuntimeWarning(message) {
  const warning = $('#runtimeWarning');
  warning.textContent = message || '';
  warning.hidden = !message;
}

function syncSettingsControls() {
  opacitySlider.value = Math.round(snapshot.settings.backgroundOpacity * 100);
  opacityValue.value = `${opacitySlider.value}%`;
  $('#alwaysOnTopToggle').checked = snapshot.settings.windowMode === 'topmost';
  $('#launchAtLoginToggle').checked = snapshot.settings.launchAtLogin;
}

async function refreshRuntimeStatus() {
  try {
    const status = await window.dotodo.getStatus();
    showRuntimeWarning(status.warnings.join('；'));
  } catch (error) {
    showRuntimeWarning(`无法读取运行状态：${error.message}`);
  }
}

function filteredTodos() {
  if (currentFilter === 'active') return todos.filter((todo) => !todo.completed);
  if (currentFilter === 'completed') return todos.filter((todo) => todo.completed);
  return todos;
}

function render() {
  todoList.replaceChildren();
  const visible = filteredTodos();

  visible.forEach((todo) => {
    const row = document.createElement('div');
    row.className = `todo-item${todo.completed ? ' completed' : ''}`;
    row.dataset.id = todo.id;

    const check = document.createElement('button');
    check.className = 'check-button';
    check.setAttribute('aria-label', todo.completed ? '标记为未完成' : '标记为已完成');
    check.innerHTML = '<svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"/></svg>';
    check.addEventListener('click', () => toggleTodo(todo.id));

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;
    text.title = todo.text;
    text.addEventListener('dblclick', () => beginEdit(todo.id, text));

    const remove = document.createElement('button');
    remove.className = 'delete-button';
    remove.setAttribute('aria-label', `删除：${todo.text}`);
    remove.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5 6h10M8 6V4h4v2m2 0-.5 10h-7L6 6m3 3v4m2-4v4"/></svg>';
    remove.addEventListener('click', () => deleteTodo(todo.id));

    row.append(check, text, remove);
    todoList.append(row);
  });

  const completed = todos.filter((todo) => todo.completed).length;
  progressLabel.textContent = `${completed} / ${todos.length}`;
  progressBar.style.width = todos.length ? `${(completed / todos.length) * 100}%` : '0%';
  clearCompleted.disabled = completed === 0;
  emptyState.classList.toggle('visible', visible.length === 0);
  todoList.hidden = visible.length === 0;

  const emptyHeading = emptyState.querySelector('h2');
  const emptyCopy = emptyState.querySelector('p');
  if (todos.length && !visible.length) {
    emptyHeading.textContent = currentFilter === 'active' ? '全部完成了' : '还没有完成项';
    emptyCopy.textContent = currentFilter === 'active' ? '今天做得很棒。' : '完成一件事后，它会出现在这里。';
  } else {
    emptyHeading.textContent = '清单空空的';
    emptyCopy.textContent = '写下一件小事，然后轻松完成它。';
  }
}

async function addTodo(text) {
  const value = text.trim();
  if (!value) return;
  acceptResult(await window.dotodo.addTask(value.slice(0, 240)));
}

async function toggleTodo(id) {
  acceptResult(await window.dotodo.toggleTask(id));
}

async function deleteTodo(id) {
  acceptResult(await window.dotodo.deleteTodayTask(id));
}

function beginEdit(id, textElement) {
  if (editingId) return;
  editingId = id;
  const todo = todos.find((item) => item.id === id);
  const input = document.createElement('input');
  input.className = 'edit-input';
  input.value = todo.text;
  input.maxLength = 240;
  textElement.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (commit && value) {
      acceptResult(await window.dotodo.editTask(id, value));
    }
    editingId = null;
    render();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

todoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await addTodo(todoInput.value);
  todoInput.value = '';
  todoInput.focus();
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button));
    render();
  });
});

clearCompleted.addEventListener('click', async () => {
  for (const todo of todos.filter((item) => item.completed)) {
    acceptResult(await window.dotodo.deleteTodayTask(todo.id));
  }
});

const settingsButton = $('#settingsButton');
const settingsPanel = $('#settingsPanel');
function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsButton.setAttribute('aria-expanded', 'false');
}
settingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = settingsPanel.classList.toggle('open');
  settingsPanel.setAttribute('aria-hidden', String(!open));
  settingsButton.setAttribute('aria-expanded', String(open));
});
settingsPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closeSettings);

const opacitySlider = $('#opacitySlider');
const opacityValue = $('#opacityValue');
opacitySlider.addEventListener('input', () => {
  opacityValue.value = `${opacitySlider.value}%`;
  window.dotodo.setBackgroundOpacity(Number(opacitySlider.value) / 100).then(acceptResult);
});
$('#alwaysOnTopToggle').addEventListener('change', (event) => {
  window.dotodo.setWindowMode(event.target.checked ? 'topmost' : 'normal').then(acceptResult);
});
$('#launchAtLoginToggle').addEventListener('change', (event) => {
  window.dotodo.setLaunchAtLogin(event.target.checked).then(acceptResult);
});
$('#minimizeButton').addEventListener('click', () => window.dotodo.minimizeWindow());
$('#closeButton').addEventListener('click', () => window.dotodo.closeWindow());

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    todoInput.focus();
  }
  if (event.key === 'Escape') closeSettings();
});

async function init() {
  const [initialSnapshot, status] = await Promise.all([
    window.dotodo.getSnapshot(),
    window.dotodo.getStatus()
  ]);
  snapshot = initialSnapshot;
  todos = snapshot.activeDay.tasks;
  syncSettingsControls();
  $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  showRuntimeWarning(status.warnings.join('；'));
  render();
}

init();
