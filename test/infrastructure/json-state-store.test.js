const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState } = require('../../src/domain/state-schema');
const { createDailyTodoEngine } = require('../../src/domain/daily-todo-engine');

let infrastructure = {};
try {
  infrastructure = require('../../src/infrastructure/json-state-store');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function withDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-store-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function populatedState(date = '2026-09-13', text = '保存我') {
  const engine = createDailyTodoEngine(createState(date), {
    now: () => `${date}T10:00:00.000+08:00`,
    createId: () => `task-${date}`
  });
  return engine.addTask(text).snapshot;
}

test('save and load round-trip a valid state without sharing references', (context) => {
  assert.equal(typeof infrastructure.JsonStateStore, 'function');
  const directory = withDirectory(context);
  const store = new infrastructure.JsonStateStore(directory);
  const state = populatedState();

  store.save(state);
  const result = store.load();
  result.state.activeDay.tasks[0].text = '外部修改';

  assert.equal(result.warning, null);
  assert.equal(store.load().state.activeDay.tasks[0].text, '保存我');
  assert.equal(fs.existsSync(path.join(directory, 'state.json')), true);
});

test('a second save keeps the previous valid state as backup', (context) => {
  const directory = withDirectory(context);
  const store = new infrastructure.JsonStateStore(directory);
  store.save(populatedState('2026-09-13', '第一版'));
  store.save(populatedState('2026-09-14', '第二版'));
  fs.rmSync(path.join(directory, 'state.json'));

  const result = store.load();

  assert.equal(result.state.activeDay.date, '2026-09-13');
  assert.equal(result.state.activeDay.tasks[0].text, '第一版');
  assert.match(result.warning, /备份/);
});

test('load preserves a corrupt primary and recovers the valid backup', (context) => {
  const directory = withDirectory(context);
  const store = new infrastructure.JsonStateStore(directory);
  store.save(populatedState('2026-09-12', '备份内容'));
  store.save(populatedState('2026-09-13', '当前内容'));
  fs.writeFileSync(path.join(directory, 'state.json'), '{broken primary', 'utf8');

  const result = store.load();

  assert.equal(result.state.activeDay.date, '2026-09-12');
  assert.equal(result.preservedCorruptFiles.length, 1);
  assert.equal(fs.readFileSync(result.preservedCorruptFiles[0], 'utf8'), '{broken primary');
  assert.match(result.warning, /损坏|备份/);
});

test('a corrupt backup is preserved even when the primary is valid', (context) => {
  const directory = withDirectory(context);
  const primaryState = populatedState('2026-09-13', '有效主文件');
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(primaryState), 'utf8');
  fs.writeFileSync(path.join(directory, 'state.backup.json'), '{recover me', 'utf8');
  const store = new infrastructure.JsonStateStore(directory);

  const result = store.load();

  assert.equal(result.state.activeDay.tasks[0].text, '有效主文件');
  assert.equal(result.preservedCorruptFiles.length, 1);
  assert.equal(fs.readFileSync(result.preservedCorruptFiles[0], 'utf8'), '{recover me');
  assert.match(result.warning, /备份.*损坏|损坏.*备份/);

  store.save(populatedState('2026-09-14', '下一版'));
  assert.equal(fs.existsSync(result.preservedCorruptFiles[0]), true);
});

test('load preserves both corrupt files before allowing a fresh save', (context) => {
  const directory = withDirectory(context);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'state.json'), '{bad primary', 'utf8');
  fs.writeFileSync(path.join(directory, 'state.backup.json'), '{bad backup', 'utf8');
  const store = new infrastructure.JsonStateStore(directory);

  const result = store.load();
  const preservedContents = result.preservedCorruptFiles.map((file) => fs.readFileSync(file, 'utf8')).sort();

  assert.equal(result.state, null);
  assert.deepEqual(preservedContents, ['{bad backup', '{bad primary']);
  store.save(populatedState());
  assert.deepEqual(result.preservedCorruptFiles.map((file) => fs.existsSync(file)), [true, true]);
});

test('a preservation failure makes the store read-only', (context) => {
  const directory = withDirectory(context);
  fs.writeFileSync(path.join(directory, 'state.json'), '{important broken data', 'utf8');
  const store = new infrastructure.JsonStateStore(directory, {
    copyFileSync: () => {
      throw new Error('disk is read-only');
    }
  });

  const result = store.load();

  assert.equal(result.state, null);
  assert.equal(result.writable, false);
  assert.deepEqual(result.preservedCorruptFiles, []);
  assert.throws(() => store.save(populatedState()), /停止写入|安全保留/);
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), '{important broken data');
});

test('backup recovery reports when the corrupt primary could not be preserved', (context) => {
  const directory = withDirectory(context);
  fs.writeFileSync(path.join(directory, 'state.json'), '{broken primary', 'utf8');
  fs.writeFileSync(
    path.join(directory, 'state.backup.json'),
    JSON.stringify(populatedState('2026-09-12', '可用备份')),
    'utf8'
  );
  const store = new infrastructure.JsonStateStore(directory, {
    copyFileSync: () => {
      throw new Error('cannot preserve');
    }
  });

  const result = store.load();

  assert.equal(result.state.activeDay.tasks[0].text, '可用备份');
  assert.equal(result.writable, false);
  assert.match(result.warning, /无法.*保留|停止写入/);
  assert.doesNotMatch(result.warning, /已保留原文件/);
});

test('a recovery directory sync failure keeps the corrupt source protected', (context) => {
  const directory = withDirectory(context);
  const primaryPath = path.join(directory, 'state.json');
  fs.writeFileSync(primaryPath, '{only recovery evidence', 'utf8');
  const store = new infrastructure.JsonStateStore(directory, {
    syncDirectory: () => {
      const error = new Error('directory I/O error');
      error.code = 'EIO';
      throw error;
    }
  });

  const result = store.load();

  assert.equal(result.writable, false);
  assert.throws(() => store.save(populatedState()), /停止写入|安全保留/);
  assert.equal(fs.readFileSync(primaryPath, 'utf8'), '{only recovery evidence');
});

test('a directory sync I/O failure is reported and leaves the old primary recoverable', (context) => {
  const directory = withDirectory(context);
  const previousState = populatedState('2026-09-13', '上一版');
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(previousState), 'utf8');
  const store = new infrastructure.JsonStateStore(directory, {
    syncDirectory: () => {
      const error = new Error('device I/O error');
      error.code = 'EIO';
      throw error;
    }
  });

  assert.throws(
    () => store.save(populatedState('2026-09-14', '下一版')),
    /无法安全写入|I\/O/
  );
  const diskState = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(diskState.activeDay.tasks[0].text, '上一版');
});

test('invalid state is rejected without replacing the current disk state', (context) => {
  const directory = withDirectory(context);
  const store = new infrastructure.JsonStateStore(directory);
  store.save(populatedState('2026-09-13', '保留内容'));
  const invalid = populatedState('2026-09-14', '非法内容');
  invalid.settings.backgroundOpacity = 0;

  assert.throws(() => store.save(invalid), /设置|状态/);
  assert.equal(store.load().state.activeDay.tasks[0].text, '保留内容');
});

test('invalid import leaves current state unchanged and export can be imported elsewhere', (context) => {
  const directory = withDirectory(context);
  const otherDirectory = withDirectory(context);
  const store = new infrastructure.JsonStateStore(directory);
  store.save(populatedState('2026-09-13', '当前内容'));
  const invalidPath = path.join(directory, 'invalid.json');
  fs.writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 999 }), 'utf8');

  assert.throws(() => store.importFrom(invalidPath), /版本|状态/);
  assert.equal(store.load().state.activeDay.tasks[0].text, '当前内容');

  const exportPath = path.join(directory, 'export.json');
  store.exportTo(exportPath, populatedState('2026-09-14', '导出内容'));
  const imported = new infrastructure.JsonStateStore(otherDirectory).importFrom(exportPath);
  assert.equal(imported.activeDay.tasks[0].text, '导出内容');
});
