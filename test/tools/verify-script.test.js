const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', '..', 'tools', 'verify-electron.ps1');
const bytes = fs.readFileSync(scriptPath);
const text = bytes.toString('utf8');

test('verify-electron.ps1 必须保存为带 BOM 的 UTF-8', () => {
  // Windows PowerShell 5.1 会用系统 ANSI 代码页（中文 Windows 上是 GBK）读取没有 BOM 的脚本，
  // 结果是满屏乱码和一串莫名其妙的语法错误。这个文件里有大量中文，
  // 所以 BOM 不是可选项。改文件时很容易被编辑器或工具顺手删掉，因此用测试钉住。
  assert.deepEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    'BOM 丢失了：脚本在 Windows PowerShell 5.1 上会因编码问题无法运行。'
  );
});

test('verify-electron.ps1 的 BOM 后面紧接着脚本内容', () => {
  assert.match(text, /^\uFEFF#Requires -Version 5\.1/);
});

test('verify-electron.ps1 里没有制表符缩进', () => {
  const offenders = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => entry.line.includes('\t'));
  assert.deepEqual(offenders.map((entry) => entry.number), [], 'PowerShell 脚本用空格缩进。');
});

test('verify-electron.ps1 不靠进程名判断要不要跳过验证', () => {
  // 曾经是 Get-Process -Name 'DoTodo', 'electron' + 路径过滤，用来决定
  // 「有没有别人的实例在跑」。这条路两头都错过：按仓库路径过滤会漏掉
  // 另一份 checkout 的实例（误报成「没起来」），按名字抓又会把不相干的
  // 进程算进来。现在改用一次性数据目录，锁本来就不冲突，不需要判断。
  assert.doesNotMatch(text, /Get-Process -Name 'DoTodo'/);
});

test('内存测量用一次性数据目录启动打包版', () => {
  // 曾经这里用真实用户数据目录启动，然后「检测到有 DoTodo 在跑就跳过」。
  // 那意味着只要桌面上开着这个应用，这一步永远是跳过的——等于没有验证，
  // 它坏掉了也没人知道。而且用真实目录启动会触发日切准备，可能动到用户数据。
  // 换成 --user-data-dir=<临时目录>：锁不再冲突，步骤每次都真的执行。
  assert.match(text, /-ArgumentList "--user-data-dir=\$probeData"/);
  assert.match(text, /Remove-Item \$probeData -Recurse -Force/);
});

test('内存测量只统计自己那棵进程树', () => {
  // Electron 是多进程的，要加起来；但机器上可能还开着别处的 DoTodo/electron，
  // 按进程名抓会把别人的内存算进这个数字里。
  assert.match(text, /Get-Process -Id \(Get-ProcessTreeId -RootId \$app\.Id\)/);
  assert.match(text, /function Get-ProcessTreeId/);
  assert.match(text, /ParentProcessId/);
});

test('内存测量只收自己启动的进程', () => {
  // 收尾时把机器上所有 DoTodo 进程都杀掉，等于替用户关掉他正开着的窗口。
  const sweepLines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => entry.line.includes('Get-Process') && entry.line.includes('Stop-Process'));
  assert.deepEqual(
    sweepLines.map((entry) => entry.number),
    [],
    '不要用管道把 Get-Process 的结果整批 Stop-Process。'
  );
  assert.match(text, /Stop-Process -Id \$app\.Id/);
});
