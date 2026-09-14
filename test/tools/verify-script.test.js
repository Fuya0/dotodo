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

test('verify-electron.ps1 同时检测开发版与安装版进程', () => {
  // 开发版进程名是 electron，安装版是 DoTodo，两者共用同一把单实例锁。
  // 只检测其中一个，就会把「被锁挡住」误报成「进程没起来」。
  assert.match(text, /Get-Process -Name 'DoTodo', 'electron'/);
});

test('内存测量检测进程时不按仓库路径过滤', () => {
  // 曾经这里是 Where-Object { $_.Path -like "$repoRoot*" }。
  // 锁是按数据目录算的，跟可执行文件在哪个目录无关：在克隆出来的第二份
  // 仓库里跑验证时，原仓库 npm start 起来的实例路径不在 $repoRoot 下，
  // 于是检测不到、打包版被锁挡住、报成「没有起来」。
  assert.doesNotMatch(
    text,
    /\$_\.Path -like "\$repoRoot\*"/,
    '按仓库路径过滤会漏掉从另一份 checkout 启动的实例。'
  );
  assert.match(text, /\$_\.ProcessName -eq 'DoTodo' -or \$_\.[Pp]ath -like '\*dotodo\*'/);
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
  assert.match(text, /Stop-Process -Id \$started\.Id/);
});
