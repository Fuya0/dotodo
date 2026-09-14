const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 课程索引里散着一批"看起来像事实"的数字：验证脚本几步、验收清单几组几项、
// 交互场景几个。这些数字没有任何东西守着，加了脚本步骤或清单条目之后
// 文档就会长期停在旧值上。这份文件把能静态算出来的那几个钉住。
//
// 刻意**不**钉「某一课多少个单元测试」这类数字：它取决于怎么数
// （顶层 test() 还是 node 报告的含子测试总数），两种算法结果不同，
// 钉一个只会制造另一种不一致。课程索引里已经不写这类数字了。

const repositoryRoot = path.join(__dirname, '..', '..');
const learningRoot = path.join(repositoryRoot, 'docs', 'learning', 'electron');
const courseIndex = fs.readFileSync(path.join(learningRoot, 'README.md'), 'utf8');
const manualChecklist = fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'testing', 'electron-windows-manual-checklist.md'),
  'utf8'
);

const CHINESE_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function scriptStepCount(relativePath) {
  const text = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  return [...text.matchAll(/Invoke-Step '([^']+)'/g)].length;
}

function scenarioCount() {
  return fs
    .readdirSync(path.join(repositoryRoot, 'test', 'ui'))
    .filter((name) => name.endsWith('.js') && name !== '_prelude.js' && !name.endsWith('.case.js')).length;
}

test('课程索引里的验证步数与脚本一致', () => {
  // 这里必须把数字和它所属的命令绑在一起验。文档里「八步」出现两次
  // （verify:win 的说明和命令清单），而「九步」是 verify:installer 的 ——
  // 只断言「文件里出现过八步」，改掉其中一处另一处会把它兜住；
  // 同理，verify:win 变成九步时，verify:installer 的「九步」又会替它顶包。
  // 两种假通过都实测复现过。
  const winSteps = scriptStepCount(path.join('tools', 'verify-electron.ps1'));
  const installerSteps = scriptStepCount(path.join('tools', 'verify-installer.ps1'));
  const win = `${CHINESE_NUMERALS[winSteps]}步`;
  const installer = `${CHINESE_NUMERALS[installerSteps]}步`;

  assert.match(
    courseIndex,
    new RegExp(`verify:win\`\\s*${win}`),
    `脚本现在是 ${winSteps} 步，课程索引的 verify:win 说明里应该写「${win}」。`
  );
  assert.match(
    courseIndex,
    new RegExp(`verify:installer\`\\s*${installer}`),
    `脚本现在是 ${installerSteps} 步，课程索引的 verify:installer 说明里应该写「${installer}」。`
  );
  assert.match(
    courseIndex,
    new RegExp(`（${win}，`),
    `命令清单里那一行也要写「（${win}，」。`
  );
});

test('课程索引里的验收清单组数与项数与清单本身一致', () => {
  // 清单条目 = 编号表格行（如 `| 2.1 | ... |`）；分组 = `## N.` 标题。
  const items = [...manualChecklist.matchAll(/^\|\s*\d+\.\d+\s*\|/gm)].length;
  const sections = [...manualChecklist.matchAll(/^## \d+\./gm)].length;
  assert.ok(items > 0 && sections > 0, '从验收清单里没数出条目，匹配规则可能失效了。');
  assert.ok(
    courseIndex.includes(`${sections} 组、${items} 项`),
    `验收清单实际是 ${sections} 组、${items} 项，课程索引里的说法要对上。`
  );
});

test('课程索引里的交互场景数与实际一致', () => {
  const count = scenarioCount();
  assert.ok(
    courseIndex.includes(`${count} 个场景`),
    `实际有 ${count} 个交互场景，课程索引里应该写「${count} 个场景」。`
  );
});

test('文档里写死的习题总数与实际一致', () => {
  // 「N 组 M 题 K 条判分测试」这个写法目前只出现在第 8 课正文里，而且长期停在
  // 「8 组 53 题 112 条」。习题索引里的那种写法（「N 道题 / M 条判分测试」）
  // 由 exercises.test.js 守。这里扫描整个文档树，是因为这句话随时可能被写到别处 ——
  // 写到哪里都得对得上。
  const exercisesRoot = path.join(repositoryRoot, 'exercises', 'electron');
  const directories = fs
    .readdirSync(exercisesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const questions = directories.reduce(
    (sum, name) => sum + Object.keys(require(path.join(exercisesRoot, name, 'starter.js'))).length,
    0
  );
  const tests = directories.reduce(
    (sum, name) =>
      sum +
      (fs.readFileSync(path.join(exercisesRoot, name, 'starter.test.js'), 'utf8').match(/^test\(/gm) ?? [])
        .length,
    0
  );

  const documents = [
    path.join(exercisesRoot, 'README.md'),
    path.join(repositoryRoot, 'README.md'),
    ...fs
      .readdirSync(learningRoot)
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(learningRoot, name))
  ];
  const claim = /(\d+) 组 (\d+) 题 (\d+) 条判分测试/g;
  let checked = 0;
  for (const document of documents) {
    const text = fs.readFileSync(document, 'utf8');
    for (const match of text.matchAll(claim)) {
      checked += 1;
      assert.deepEqual(
        [Number(match[1]), Number(match[2]), Number(match[3])],
        [directories.length, questions, tests],
        `${path.basename(document)} 里的习题总数与实际不符。`
      );
    }
  }
  // 如果哪天这句话改了写法，上面一个都没匹配到，这条守卫就静悄悄地什么都不验了。
  assert.ok(checked > 0, '一个习题总数声明都没匹配到，守卫已经失效。');
});

test('课程索引不再写死每课的单元测试条数', () => {
  // 曾经写着「（35 个）」「（142 条断言）」这类数字，全部与实测不符 ——
  // 因为它们取决于用哪种方式数。与其钉一个口径，不如不写。
  assert.doesNotMatch(courseIndex, /（\d+ 个）/, '课程索引里不要写死测试条数。');
  assert.doesNotMatch(courseIndex, /（\d+ 条断言）/, '课程索引里不要写死断言条数。');
});
