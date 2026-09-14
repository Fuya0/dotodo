const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repositoryRoot, 'tools', 'verify-installer.ps1');
const bytes = fs.readFileSync(scriptPath);
const text = bytes.toString('utf8');

function codeLines() {
  // 注释里会解释「为什么不能用某种写法」，那些行不该被当成违规。
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line.length > 0 && !entry.line.startsWith('#'));
}

test('verify-installer.ps1 必须保存为带 BOM 的 UTF-8', () => {
  // 和 verify-electron.ps1 同样的原因：文件里全是中文，Windows PowerShell 5.1
  // 没有 BOM 就会按系统 GBK 代码页读，然后满屏语法错误。
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 丢失了。');
});

test('verify-installer.ps1 里没有制表符缩进', () => {
  const offenders = text.split(/\r?\n/).filter((line) => line.includes('\t'));
  assert.deepEqual(offenders, []);
});

test('卸载项按前缀匹配 DisplayName，不能用等号', () => {
  // 真实值是「DoTodo 1.0.0」，带版本号。用 -eq 'DoTodo' 一条都匹配不上 ——
  // 而且这不只是查询失败：「已有安装就不动手」的安全守卫用的是同一个函数，
  // 匹配不上它就会放行，然后覆盖掉用户那套的卸载项。
  const equalityChecks = codeLines().filter(
    (entry) => entry.line.includes('DisplayName') && entry.line.includes('-eq $productName')
  );
  assert.deepEqual(
    equalityChecks.map((entry) => entry.number),
    [],
    'DisplayName 带版本号，必须按前缀匹配。'
  );
  assert.match(text, /DisplayName -match \$pattern/);
});

test('卸载项不要求 InstallLocation 存在', () => {
  // electron-builder 的按用户安装不写这个值。要求它有，就等于要求一个
  // 上游从不提供的字段，这步会永远失败。
  const locationChecks = codeLines().filter(
    (entry) => entry.line.includes('InstallLocation') && entry.line.includes('throw')
  );
  assert.deepEqual(
    locationChecks.map((entry) => entry.number),
    [],
    '不要因为缺少 InstallLocation 就判定失败。'
  );
  // 判断「卸载项指向哪里」改用卸载命令和图标路径。
  assert.match(text, /UninstallString/);
  assert.match(text, /pointsAtUs/);
});

test('卸载走注册表里的 QuietUninstallString', () => {
  // 那是 Windows「设置 → 应用」真正会执行的命令，我们要验的就是它管不管用。
  assert.match(text, /QuietUninstallString/);
});

test('检测到已有安装时拒绝动手', () => {
  // 我们静默装到临时目录，但卸载信息是按 appId 写在注册表里的同一个键。
  // 如果用户自己装过 DoTodo，我们再装一次就会覆盖他的卸载入口。
  assert.match(text, /已经装过 DoTodo/);
  assert.match(text, /已经装过 DoTodo[\s\S]{0,200}throw/);
});

test('失败也要把装好的东西收尾卸掉', () => {
  // 中途失败却把应用留在机器上，比失败本身更糟。
  assert.match(text, /finally \{/);
  assert.match(text, /前面有步骤失败，收尾卸载/);
});

test('脚本不会删用户数据目录', () => {
  // 卸载验证跑完，用户的清单必须还在。脚本只允许读这个目录。
  const destructive = codeLines().filter(
    (entry) =>
      entry.line.includes('$realUserDataDirectory') &&
      (entry.line.includes('Remove-Item') || entry.line.includes('New-Item'))
  );
  assert.deepEqual(
    destructive.map((entry) => entry.number),
    [],
    '用户数据目录只能读、不能删也不能建。'
  );
  // 而且要用指纹证明自己没碰过它。
  assert.match(text, /Get-UserDataFingerprint/);
  assert.match(text, /用户数据被改动了/);
});

test('安装相关的断言不依赖退出码', () => {
  // 与 verify-electron.ps1 同样的坑：Start-Process 配合重定向时
  // ExitCode 取不到值，拿它判断会「什么都没查却显示成功」。
  const exitCodeLines = codeLines().filter((entry) => entry.line.includes('.ExitCode'));
  assert.deepEqual(exitCodeLines.map((entry) => entry.number), []);
});

test('package.json 暴露 verify:installer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(manifest.scripts['verify:installer'] || '', /verify-installer\.ps1/);
  // 这个脚本会往机器上装东西，不能混进默认的 verify:win。
  assert.doesNotMatch(manifest.scripts['verify:win'] || '', /verify-installer/);
});
