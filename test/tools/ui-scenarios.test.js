const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scenarioDirectory = path.join(__dirname, '..', '..', 'test', 'ui');
const prelude = fs.readFileSync(path.join(scenarioDirectory, '_prelude.js'), 'utf8');

function scenarioFiles() {
  return fs
    .readdirSync(scenarioDirectory)
    // `_prelude.js` 是公共前置，`*.case.js` 是 Node 侧的配对文件，都不是场景本身。
    .filter((name) => name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.case.js'))
    .sort();
}

function caseFiles() {
  return fs
    .readdirSync(scenarioDirectory)
    .filter((name) => name.endsWith('.case.js'))
    .sort();
}

test('至少有一个交互场景', () => {
  assert.ok(scenarioFiles().length > 0, 'test/ui/ 下应该有场景文件。');
});

test('每个场景都以 return results 收尾', () => {
  // 场景是当作函数体丢进渲染进程执行的。忘了 return，runner 就收不到任何断言，
  // 只会报一句「没有收到场景结果」，排查起来要绕一圈。这里提前拦住。
  for (const name of scenarioFiles()) {
    const source = fs.readFileSync(path.join(scenarioDirectory, name), 'utf8');
    assert.match(source, /return results;\s*$/, `场景 ${name} 必须以 return results; 结尾。`);
  }
});

test('场景里不能出现 require 或 process', () => {
  // 场景跑在渲染进程里，那里没有 Node。用了就会在运行时才炸。
  for (const name of scenarioFiles()) {
    const source = fs.readFileSync(path.join(scenarioDirectory, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(source, /\brequire\s*\(/, `${name} 不应调用 require()`);
    assert.doesNotMatch(source, /\bprocess\s*\./, `${name} 不应访问 process`);
  }
});

test('前置代码提供了场景依赖的辅助函数', () => {
  for (const helper of ['const q =', 'const qa =', 'function check(', 'async function expect(', 'function press(']) {
    assert.ok(prelude.includes(helper), `_prelude.js 缺少 ${helper}`);
  }
  assert.match(prelude, /const results = \[\];/);
});

test('每个 .case.js 都有同名的场景文件', () => {
  // 配对文件是给场景提供起始存档和 Node 侧检查的。单独存在说明场景被删了却忘了删它。
  for (const name of caseFiles()) {
    const scenario = name.replace(/\.case\.js$/, '.js');
    assert.ok(
      scenarioFiles().includes(scenario),
      `${name} 没有对应的场景文件 ${scenario}`
    );
  }
});

test('.case.js 是 Node 侧文件，必须导出可用的钩子', () => {
  // 和场景文件相反：它跑在 Node 里，可以（也需要）用 require 和 fs。
  for (const name of caseFiles()) {
    const module = require(path.join(scenarioDirectory, name));
    assert.equal(typeof module, 'object', `${name} 应该导出一个对象。`);
    const hooks = ['fixture', 'prepare', 'verify'].filter((key) => typeof module[key] === 'function');
    assert.ok(hooks.length > 0, `${name} 至少要导出 fixture / prepare / verify 之一。`);
    if (module.fixture) {
      const value = module.fixture();
      assert.ok(value === null || typeof value === 'object', `${name} 的 fixture() 必须返回对象或 null。`);
    }
    for (const hook of ['prepare', 'verify']) {
      if (module[hook]) assert.equal(module[hook].length, 1, `${name} 的 ${hook}() 应该只接收数据目录一个参数。`);
    }
  }
});

const rendererDirectory = path.join(__dirname, '..', '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(rendererDirectory, 'app.js'), 'utf8');

const declaredIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

/**
 * 界面上的类名有两个来源：HTML 里写死的，和 app.js 在渲染时拼出来的。
 * 后者既有普通字符串（`className = 'check-button'`），也有模板字符串
 * （`` className = `history-row${...}` ``），所以两种字面量都要扫。
 */
function classTokensFromApp() {
  const literals = [...app.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  return literals
    .flatMap((literal) => literal.split(/[\s${}?:.,;()[\]]+/))
    .filter((token) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(token));
}

const knownClasses = new Set([
  ...[...html.matchAll(/\sclass="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)),
  ...classTokensFromApp()
]);

/**
 * 判断某个选择器后面跟的是不是「这东西不该存在」的断言。
 * 这两种写法都算：`q('#x') === null` 和 `qa('.x').length === 0`。
 * `!q('#x').hidden` 不算——那是在断言元素存在且可见，仍然要校验选择器本身。
 */
function isAbsenceAssertion(source, match) {
  const tail = source.slice(match.index + match[0].length).trimStart();
  return tail.startsWith('=== null') || /^\.length\s*===\s*0/.test(tail);
}

test('场景用到的界面选择器都真的存在', () => {
  for (const name of scenarioFiles()) {
    const source = fs.readFileSync(path.join(scenarioDirectory, name), 'utf8');

    for (const match of source.matchAll(/\bq\('#([A-Za-z0-9_-]+)'\)/g)) {
      if (isAbsenceAssertion(source, match)) continue;
      assert.ok(declaredIds.has(match[1]), `${name} 查询了不存在的 id：${match[1]}`);
    }

    for (const match of source.matchAll(/\bqa?\('\.([A-Za-z0-9_-]+)'\)/g)) {
      if (isAbsenceAssertion(source, match)) continue;
      assert.ok(
        knownClasses.has(match[1]),
        `${name} 使用了 HTML 和 app.js 里都没有的类：.${match[1]}`
      );
    }
  }
});
