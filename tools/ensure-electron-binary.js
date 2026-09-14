#!/usr/bin/env node
'use strict';

// electron 从 42 起上游去掉了 package.json 里的 postinstall：二进制不再随
// npm install 一起下载，而是第一次用到时才下。我们锁的是 44.3.0，正好落在这之后。
//
// 这件事对本项目的伤害比看上去大：测试是 node --test 并行跑多个文件，其中几个
// 会 require('electron')。新克隆的仓库跑第一次 npm test 时，多个进程同时发现
// 二进制缺失、同时开始下载解压，撞在一起报
//   failed to create directory '...\electron\dist\locales': os error 183
// 于是测试随机失败；而 npm run verify:win 更早的那一步只会说「请先执行
// npm install」——你刚执行完。已经实测复现过。
//
// 所以这里补一个自己的 postinstall，把下载放回安装阶段一次做完，
// 不留给后面的并行进程去抢。install.js 自带幂等判断（装好了就直接退出）。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 与 electron 自己 install.js 里的 getPlatformPath 保持一致。
const PLATFORM_BINARY = {
  win32: ['dist', 'electron.exe'],
  darwin: ['dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'],
  linux: ['dist', 'electron']
};

function resolveElectronBinaryPath(repositoryRoot, platform) {
  const relative = PLATFORM_BINARY[platform];
  if (!relative) return null;
  return path.join(repositoryRoot, 'node_modules', 'electron', ...relative);
}

function resolveElectronInstallerPath(repositoryRoot) {
  return path.join(repositoryRoot, 'node_modules', 'electron', 'install.js');
}

/**
 * 确保 electron 二进制存在。所有副作用都通过参数注入，方便测试。
 * 返回 { status, binary, exitCode }，status 取值见下面的分支。
 */
function ensureElectronBinary(options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '..');
  const platform = options.platform || process.platform;
  const exists = options.exists || ((target) => fs.existsSync(target));
  const run = options.run || ((command, args, runOptions) => spawnSync(command, args, runOptions));
  const execPath = options.execPath || process.execPath;

  const binary = resolveElectronBinaryPath(repositoryRoot, platform);
  if (binary === null) {
    return { status: 'unsupported-platform', platform, binary: null, exitCode: 0 };
  }
  if (exists(binary)) {
    return { status: 'already-installed', binary, exitCode: 0 };
  }

  const installer = resolveElectronInstallerPath(repositoryRoot);
  if (!exists(installer)) {
    return { status: 'missing-installer', binary, exitCode: 1 };
  }

  const result = run(execPath, [installer], { cwd: repositoryRoot, stdio: 'inherit' });
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  if (exitCode !== 0) {
    return { status: 'install-failed', binary, exitCode };
  }
  return { status: 'installed', binary, exitCode: 0 };
}

function main() {
  const result = ensureElectronBinary();
  if (result.status === 'already-installed') {
    return 0;
  }
  if (result.status === 'installed') {
    console.log('Electron 二进制已下载完成。');
    return 0;
  }
  if (result.status === 'unsupported-platform') {
    // 没见过的平台不是错误：不拦着安装，交给 electron 自己报。
    return 0;
  }
  if (result.status === 'missing-installer') {
    console.error('找不到 node_modules/electron/install.js，依赖没装全。请先执行 npm install。');
    return 1;
  }
  console.error(`Electron 二进制下载失败（退出码 ${result.exitCode}）。`);
  console.error('国内网络可以设置镜像后重试：');
  console.error('  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"');
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  PLATFORM_BINARY,
  ensureElectronBinary,
  resolveElectronBinaryPath,
  resolveElectronInstallerPath
};
