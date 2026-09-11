const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = Object.freeze({
  todos: [],
  opacity: 0.94,
  alwaysOnTop: true,
  launchAtLogin: false,
  windowBounds: { width: 390, height: 610 }
});

function sanitizeTodo(todo) {
  if (!todo || typeof todo !== 'object') return null;
  const text = typeof todo.text === 'string' ? todo.text.trim().slice(0, 240) : '';
  if (!text) return null;
  return {
    id: typeof todo.id === 'string' ? todo.id : `${Date.now()}-${Math.random()}`,
    text,
    completed: Boolean(todo.completed),
    createdAt: Number.isFinite(todo.createdAt) ? todo.createdAt : Date.now()
  };
}

function normalizeState(input = {}) {
  const bounds = input.windowBounds || {};
  return {
    todos: Array.isArray(input.todos) ? input.todos.map(sanitizeTodo).filter(Boolean).slice(0, 1000) : [],
    opacity: Math.min(1, Math.max(0.55, Number(input.opacity) || DEFAULT_STATE.opacity)),
    alwaysOnTop: input.alwaysOnTop !== false,
    launchAtLogin: Boolean(input.launchAtLogin),
    windowBounds: {
      x: Number.isFinite(bounds.x) ? bounds.x : undefined,
      y: Number.isFinite(bounds.y) ? bounds.y : undefined,
      width: Math.min(720, Math.max(330, Number(bounds.width) || DEFAULT_STATE.windowBounds.width)),
      height: Math.min(900, Math.max(420, Number(bounds.height) || DEFAULT_STATE.windowBounds.height))
    }
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this.read();
  }

  read() {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch {
      return normalizeState(DEFAULT_STATE);
    }
  }

  get() {
    return structuredClone(this.state);
  }

  set(patch) {
    this.state = normalizeState({ ...this.state, ...patch });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporaryPath, this.filePath);
    return this.get();
  }
}

module.exports = { DEFAULT_STATE, JsonStore, normalizeState };
