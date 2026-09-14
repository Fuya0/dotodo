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
