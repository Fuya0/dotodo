#!/usr/bin/env node
'use strict';

// 把本仓库的 git 钩子目录指向版本化的 .githooks。
//
// 为什么需要钩子：tools/verify-electron.ps1 里全是中文，Windows PowerShell 5.1
// 必须看到 UTF-8 BOM 才不会按系统 GBK 代码页去读，而工具很容易顺手把 BOM 删掉。
// 删掉之后脚本满屏语法错误，却要等到有人真的去跑验证才发现。已经发生过两次。
// 与其靠记性，不如让提交前自动跑一次测试。
//
// 这个脚本由 package.json 的 prepare 钩子调用，npm install / npm ci 时会自动执行。
// 所有失败都被吞掉：在没有 git 的环境（比如从 tarball 解压出来的目录）里，
// 不应该因为配不了钩子就让 npm install 失败。

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');

// 不是 git 工作区就安静退出。注意工作区里 .git 可能是个文件（worktree），
// 所以用 existsSync 而不是判断目录。
if (!fs.existsSync(path.join(repositoryRoot, '.git'))) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repositoryRoot,
    stdio: 'ignore'
  });
} catch {
  // 没有 git 可用，或者 git 拒绝了这次配置。都不该影响安装。
}
