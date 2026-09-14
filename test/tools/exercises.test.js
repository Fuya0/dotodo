const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const exercisesRoot = path.join(__dirname, '..', '..', 'exercises', 'electron');
const exercisesIndex = fs.readFileSync(path.join(exercisesRoot, 'README.md'), 'utf8');

function exerciseDirectories() {
  return fs
    .readdirSync(exercisesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(exercisesRoot, entry.name))
    .sort();
}

test('找到了习题组', () => {
  assert.ok(exerciseDirectories().length >= 8, '至少应该有 8 组习题。');
});

test('每组习题都是 README + starter.js + starter.test.js 三件套', () => {
  for (const directory of exerciseDirectories()) {
    for (const file of ['README.md', 'starter.js', 'starter.test.js']) {
      assert.ok(
        fs.existsSync(path.join(directory, file)),
        `${path.basename(directory)} 缺少 ${file}`
      );
    }
  }
});

test('starter.js 导出的每个函数都在自己的 README 里说明过', () => {
  // 目标要求「每轮交付课程章节 + 配套习题」。加了题却不写说明，
  // 学习者只能靠读测试反推题意——这条守卫就是防这个。
  for (const directory of exerciseDirectories()) {
    const name = path.basename(directory);
    const exported = Object.keys(require(path.join(directory, 'starter.js')));
    const readme = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');

    const undocumented = exported.filter((fn) => !readme.includes(`\`${fn}(`));
    assert.deepEqual(undocumented, [], `${name} 的 README 没有说明：${undocumented.join('、')}`);
    assert.ok(exported.length > 0, `${name} 的 starter.js 没有导出任何函数。`);
  }
});

test('starter.js 里每个导出函数都有函数声明', () => {
  for (const directory of exerciseDirectories()) {
    const name = path.basename(directory);
    const source = fs.readFileSync(path.join(directory, 'starter.js'), 'utf8');
    const exported = Object.keys(require(path.join(directory, 'starter.js')));

    for (const fn of exported) {
      assert.match(
        source,
        new RegExp(`function ${fn}\\(`),
        `${name}：${fn} 被导出了，但没有对应的函数声明。`
      );
    }
  }
});

test('starter.test.js 从同目录的 starter 取值', () => {
  for (const directory of exerciseDirectories()) {
    const name = path.basename(directory);
    const source = fs.readFileSync(path.join(directory, 'starter.test.js'), 'utf8');
    assert.match(source, /require\('\.\/starter'\)/, `${name} 的测试没有 require('./starter')。`);
    assert.ok(
      (source.match(/^test\(/gm) ?? []).length > 0,
      `${name} 的测试文件里一个 test() 都没有。`
    );
  }
});

test('习题索引列出了每一组习题', () => {
  // 索引和目录是两处独立维护的东西，最容易出现"加了新组但忘了写进索引"。
  for (const directory of exerciseDirectories()) {
    const name = path.basename(directory);
    assert.ok(
      exercisesIndex.includes(`${name}/`),
      `exercises/electron/README.md 没有列出 ${name}/`
    );
  }
});

test('习题索引里的每一组都真实存在', () => {
  const linked = [...exercisesIndex.matchAll(/\]\((\d\d-[a-z-]+)\//g)].map((match) => match[1]);
  assert.ok(linked.length > 0, '索引里应该至少有一个习题组链接。');
  for (const name of linked) {
    assert.ok(
      fs.existsSync(path.join(exercisesRoot, name)),
      `索引里链接了不存在的 ${name}/`
    );
  }
});

test('课程索引里的每一课文件都真实存在', () => {
  const learningRoot = path.join(__dirname, '..', '..', 'docs', 'learning', 'electron');
  const index = fs.readFileSync(path.join(learningRoot, 'README.md'), 'utf8');
  const linked = [...index.matchAll(/\]\((\d\d-[a-z-]+\.md|[a-z-]+\.md)\)/g)].map((match) => match[1]);
  assert.ok(linked.length >= 9, `课程索引里应该链接至少 9 课，实际 ${linked.length}。`);
  for (const file of linked) {
    assert.ok(fs.existsSync(path.join(learningRoot, file)), `课程索引链接了不存在的 ${file}`);
  }
});

test('每一课都能从索引点到，每一个课程文件也都在索引里', () => {
  const learningRoot = path.join(__dirname, '..', '..', 'docs', 'learning', 'electron');
  const index = fs.readFileSync(path.join(learningRoot, 'README.md'), 'utf8');
  const files = fs
    .readdirSync(learningRoot)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();

  const missing = files.filter((name) => !index.includes(`(${name})`));
  assert.deepEqual(missing, [], `课程索引里漏了：${missing.join('、')}`);
});
