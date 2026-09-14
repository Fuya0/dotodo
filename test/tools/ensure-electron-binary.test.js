const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ensureElectronBinary,
  resolveElectronBinaryPath,
  resolveElectronInstallerPath
} = require('../../tools/ensure-electron-binary.js');

const repositoryRoot = path.join(__dirname, '..', '..');

function fakeExists(existing) {
  return (target) => existing.includes(target);
}

test('每个平台的二进制路径与 electron 自己的 install.js 一致', () => {
  // 路径写错的话，postinstall 会「装好了」却检查不到，然后每次 npm install
  // 都重新下载一遍 —— 而且没有任何报错。
  const root = path.join('C:', 'app');
  assert.equal(
    resolveElectronBinaryPath(root, 'win32'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  );
  assert.equal(
    resolveElectronBinaryPath(root, 'darwin'),
    path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  );
  assert.equal(
    resolveElectronBinaryPath(root, 'linux'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron')
  );
});

test('不认识的平台返回 null，而不是编一个路径出来', () => {
  assert.equal(resolveElectronBinaryPath(path.join('C:', 'app'), 'freebsd'), null);
});

test('二进制已经装好时不做任何事', () => {
  let called = false;
  const result = ensureElectronBinary({
    repositoryRoot: path.join('C:', 'app'),
    platform: 'win32',
    exists: () => true,
    run: () => {
      called = true;
      return { status: 0 };
    }
  });
  assert.equal(result.status, 'already-installed');
  // 这一步是关键：npm install 每次都会跑 postinstall，装好的情况下
  // 绝不能又去下载一遍。
  assert.equal(called, false);
});

test('二进制缺失时调用 electron 自己的 install.js', () => {
  const root = path.join('C:', 'app');
  const installer = resolveElectronInstallerPath(root);
  const calls = [];
  const result = ensureElectronBinary({
    repositoryRoot: root,
    platform: 'win32',
    exists: fakeExists([installer]),
    execPath: 'node.exe',
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(result.status, 'installed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node.exe');
  assert.deepEqual(calls[0].args, [installer]);
  // 必须在仓库根目录执行，install.js 依赖这个 cwd 找 package.json。
  assert.equal(calls[0].options.cwd, root);
  // 下载进度要能被人看见，所以不能把输出吞掉。
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('下载失败时把退出码传出去', () => {
  const root = path.join('C:', 'app');
  const result = ensureElectronBinary({
    repositoryRoot: root,
    platform: 'win32',
    exists: fakeExists([resolveElectronInstallerPath(root)]),
    run: () => ({ status: 7 })
  });
  assert.equal(result.status, 'install-failed');
  assert.equal(result.exitCode, 7);
});

test('依赖没装全（没有 install.js）时报告 missing-installer', () => {
  const result = ensureElectronBinary({
    repositoryRoot: path.join('C:', 'app'),
    platform: 'win32',
    exists: () => false,
    run: () => {
      throw new Error('不该走到下载');
    }
  });
  assert.equal(result.status, 'missing-installer');
  assert.equal(result.exitCode, 1);
});

test('package.json 用 postinstall 把二进制补回安装阶段', () => {
  // electron 42 起上游取消了 postinstall。没有这一条，新克隆的仓库
  // npm ci 之后跑不了任何东西，第一次 npm test 还会因为多个并行测试文件
  // 抢着下载解压而报 os error 183。
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(manifest.scripts.postinstall || '', /ensure-electron-binary\.js/);
});

test('现在这个仓库里 electron 二进制确实在', () => {
  // 上面几条测的是判断逻辑；这条测的是「在这个工作区里真的成立」。
  const binary = resolveElectronBinaryPath(repositoryRoot, process.platform);
  assert.ok(binary, `不认识的平台：${process.platform}`);
  assert.ok(
    fs.existsSync(binary),
    '当前工作区没有 electron 二进制，postinstall 没起作用。先跑一次 npm install。'
  );
});
