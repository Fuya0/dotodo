const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 发布清单里写着「八步全绿，含交互场景 288 条断言」这类数字，而它曾经长期停留在
// 「七步 / 85 条」——脚本加了步骤，文档没人改。数字对不上时读者会怀疑清单，
// 或者更糟：以为多出来的那步不存在。所以把文档里可静态验证的数字钉在脚本上。

const repositoryRoot = path.join(__dirname, '..', '..');
const checklistPath = path.join(repositoryRoot, 'docs', 'release', 'windows-release-checklist.md');
const checklist = fs.readFileSync(checklistPath, 'utf8');
const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');

const CHINESE_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function scriptSteps(relativePath) {
  const text = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  return [...text.matchAll(/Invoke-Step '([^']+)'/g)].map((match) => match[1]);
}

function scenarioFiles() {
  const directory = path.join(repositoryRoot, 'test', 'ui');
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.js') && name !== '_prelude.js' && !name.endsWith('.case.js'));
}

test('发布清单写的 verify:win 步数与脚本一致', () => {
  const steps = scriptSteps(path.join('tools', 'verify-electron.ps1'));
  const expected = `${CHINESE_NUMERALS[steps.length]}步`;
  // 必须精确到形式：清单里有两处提到步数（第 1 节的步骤列表和进度表），
  // 只断言「文件里出现过八步」的话，改掉其中一处另一处还能把它兜住 ——
  // 探针实测过，这种写法会漏掉漂移。
  assert.ok(
    checklist.includes(`${expected}：`),
    `第 1 节的步骤列表应该以「${expected}：」开头（脚本现在是 ${steps.length} 步）。`
  );
  // 进度表记录当前验证状态，不要求永远声称通过；这里只核对执行步骤。
});

test('发布清单写的 verify:installer 步数与脚本一致', () => {
  const steps = scriptSteps(path.join('tools', 'verify-installer.ps1'));
  const expected = `${CHINESE_NUMERALS[steps.length]}步`;
  assert.ok(
    checklist.includes(`${expected}：`),
    `第 5 节应该以「${expected}：」开头（脚本现在是 ${steps.length} 步）。`
  );
  // 进度表记录当前验证状态，不要求永远声称通过；这里只核对执行步骤。
});

test('发布清单第 1 节点名了 verify:win 的每一步', () => {
  // 步骤名里带括号的说明（比如「单元与集成测试 (npm test)」）在文档里是省略的，
  // 所以只比对括号前那一段。
  const missing = scriptSteps(path.join('tools', 'verify-electron.ps1'))
    .map((name) => name.split(' (')[0].trim())
    .filter((name) => !checklist.includes(name));
  assert.deepEqual(missing, [], '这几步在发布清单里没被提到，加了步骤就要同步文档。');
});

test('文档里的交互场景数与实际场景文件数一致', () => {
  const count = scenarioFiles().length;
  assert.ok(count > 0, '一个交互场景都没有，这个测试就没意义了。');
  const claim = `${count} 个场景`;
  assert.ok(checklist.includes(claim), `发布清单里应该写「${claim}」。`);
  assert.ok(readme.includes(claim), `README 里应该写「${claim}」。`);
});

test('交互场景的断言总数不写死在文档里', () => {
  // 断言数在场景里是循环产生的，静态数不出来（168 个 check( 调用对应 288 条断言）。
  // 写死就会漂移，所以文档只承诺场景数，断言数让运行结果说话。
  assert.doesNotMatch(checklist, /\d+\s*条断言/, '发布清单里不要写死断言总数。');
  assert.doesNotMatch(readme, /ui-check[^\n]*\d+\s*条断言/, 'README 里不要写死断言总数。');
});
