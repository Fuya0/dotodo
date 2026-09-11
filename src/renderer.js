const $ = (selector) => document.querySelector(selector);
const todoList = $('#todoList');
const emptyState = $('#emptyState');
const todoInput = $('#todoInput');
const todoForm = $('#todoForm');
const progressLabel = $('#progressLabel');
const progressBar = $('#progressBar');
const clearCompleted = $('#clearCompleted');

let todos = [];
let currentFilter = 'all';
let editingId = null;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function save() {
  return window.dotodo.saveTodos(todos);
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
  todos.unshift({ id: makeId(), text: value.slice(0, 240), completed: false, createdAt: Date.now() });
  await save();
  render();
}

async function toggleTodo(id) {
  todos = todos.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo);
  await save();
  render();
}

async function deleteTodo(id) {
  todos = todos.filter((todo) => todo.id !== id);
  await save();
  render();
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
      todos = todos.map((item) => item.id === id ? { ...item, text: value } : item);
      await save();
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
  todos = todos.filter((todo) => !todo.completed);
  await save();
  render();
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
  window.dotodo.setOpacity(Number(opacitySlider.value) / 100);
});
$('#alwaysOnTopToggle').addEventListener('change', (event) => window.dotodo.setAlwaysOnTop(event.target.checked));
$('#launchAtLoginToggle').addEventListener('change', (event) => window.dotodo.setLaunchAtLogin(event.target.checked));
$('#minimizeButton').addEventListener('click', () => window.dotodo.minimize());
$('#closeButton').addEventListener('click', () => window.dotodo.close());

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    todoInput.focus();
  }
  if (event.key === 'Escape') closeSettings();
});

async function init() {
  const state = await window.dotodo.getState();
  todos = state.todos;
  opacitySlider.value = Math.round(state.opacity * 100);
  opacityValue.value = `${opacitySlider.value}%`;
  $('#alwaysOnTopToggle').checked = state.alwaysOnTop;
  $('#launchAtLoginToggle').checked = state.launchAtLogin;
  $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  render();
}

init();
