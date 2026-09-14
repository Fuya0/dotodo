const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { defaultDataDirectory, prepareAcceptanceData } = require('../../tools/acceptance-prep.js');
const { JsonStateStore } = require('../../src/infrastructure/json-state-store.js');
const { validateState } = require('../../src/domain/state-schema.js');

const repositoryRoot = path.join(__dirname, '..', '..');
const checklistPath = path.join(repositoryRoot, 'docs', 'testing', 'acceptance-quick.md');

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-acceptance-test-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('默认目录在系统临时目录里，不指向真实清单', () => {
  // 验收必须与真实数据隔离。写错一行就会动到用户的清单，
  // 所以把"默认落在哪里"钉住。
  const directory = defaultDataDirectory();
  assert.ok(
    directory.startsWith(os.tmpdir()),
    `默认目录应该在系统临时目录下，实际是 ${directory}`
  );
  const realUserData = path.join(process.env.APPDATA || '', 'dotodo');
  assert.ok(
    !directory.startsWith(realUserData),
    `默认目录绝不能落在真实清单目录里：${directory}`
  );
});

test('准备出来的数据是合法状态，而且真实的 store 读得回来', () => {
  withTemporaryDirectory((directory) => {
    const prepared = prepareAcceptanceData({ dataDirectory: directory });
    assert.equal(prepared.ok, true, prepared.error);

    // 用领域层的校验器再验一遍：工具自己说 ok 不算证据。
    const validated = validateState(JSON.parse(fs.readFileSync(prepared.stateFile, 'utf8')));
    assert.equal(validated.ok, true, validated.error);

    // 最强的一条：用应用真正使用的 store 把它读回来。
    // 手写一个"看起来对"的 JSON 却在加载时被拒，是这类夹具最容易犯的错。
    // 注意 load() 返回的是 { state, warning, preservedCorruptFiles, writable }，
    // 没有 ok 字段 —— 读没读到看 state 是不是 null。
    const loaded = new JsonStateStore(directory).load();
    assert.ok(loaded.state, `store 没能把验收数据读回来：${loaded.warning || '（无警告）'}`);
    assert.equal(loaded.warning, null, `正常数据不该有警告：${loaded.warning}`);
    assert.equal(loaded.state.activeDay.tasks.length, 9);
    assert.equal(loaded.state.history.length, 1);
    assert.equal(loaded.state.settings.windowMode, 'normal');
  });
});

test('验收数据里恰好有一条可以延续的历史任务', () => {
  // 第 6 条验收项要检查"延续终身只有一次"。数据里如果没有可延续的任务，
  // 那一项就没法验；如果有两条，用户看到两条按钮会以为哪里不对。
  withTemporaryDirectory((directory) => {
    const prepared = prepareAcceptanceData({ dataDirectory: directory });
    const historyTasks = prepared.state.history.flatMap((day) => day.tasks);
    const continuable = historyTasks.filter(
      (task) => !task.completed && !task.hasBeenContinued
    );
    assert.equal(continuable.length, 1, `可延续的历史任务应该有 1 条，实际 ${continuable.length} 条`);
    assert.equal(continuable[0].text, '给客户回邮件');

    // 第 3、4 条验收项要拿"未完成的今日任务"和"已完成的任务"做对照。
    const todayTasks = prepared.state.activeDay.tasks;
    assert.ok(todayTasks.some((task) => task.completed), '今日任务里要有已完成的');
    assert.ok(todayTasks.some((task) => !task.completed), '今日任务里要有未完成的');
  });
});

test('每次都从同一个已知状态开始', () => {
  // 用户可能跑两遍。第二遍如果继承了上一遍的改动，验收结果就不可比了。
  withTemporaryDirectory((directory) => {
    const first = prepareAcceptanceData({ dataDirectory: directory });
    fs.writeFileSync(first.stateFile, '{"schemaVersion":1}', 'utf8');
    fs.writeFileSync(path.join(directory, 'state.backup.json'), '{}', 'utf8');

    const second = prepareAcceptanceData({ dataDirectory: directory });
    assert.equal(second.ok, true, second.error);
    assert.deepEqual(second.state, first.state);
    // 上一遍留下的备份也要清掉，否则应用可能从旧备份恢复出别的东西。
    assert.equal(fs.existsSync(path.join(directory, 'state.backup.json')), false);
  });
});

test('启动命令用 --user-data-dir，而不是 smoke 专用变量', () => {
  // DOTODO_SMOKE_USER_DATA 只在 --smoke-test 下生效（见 src/main.js），
  // 拿它当验收的隔离手段会静默失效——应用照样去读真实清单。
  const source = fs.readFileSync(path.join(repositoryRoot, 'tools', 'acceptance-prep.js'), 'utf8');
  assert.match(source, /--user-data-dir=/);
  assert.doesNotMatch(source, /DOTODO_SMOKE_USER_DATA/);
});

test('验收清单和工具对得上', () => {
  assert.ok(fs.existsSync(checklistPath), '缺少 docs/testing/acceptance-quick.md');
  const checklist = fs.readFileSync(checklistPath, 'utf8');

  const items = [...checklist.matchAll(/^### (\d+)\. /gm)].map((match) => Number(match[1]));
  assert.ok(items.length >= 10, `清单只有 ${items.length} 条，太少了`);
  // 编号必须是 1..N 连续的：跳号会让人以为漏看了一条。
  assert.deepEqual(items, items.map((_, index) => index + 1), '清单编号必须从 1 连续排下来');

  // 清单要告诉人怎么启动，而且必须提到隔离数据的那个命令。
  assert.match(checklist, /npm run acceptance/);
  assert.match(checklist, /--user-data-dir/);
  // 每条都要写清"应该看到什么"，否则用户没法判断对错。
  const expectations = [...checklist.matchAll(/\*\*应该看到\*\*/g)].length;
  assert.ok(expectations >= items.length - 1, '多数条目都要写明预期，实际写得不够');
});
