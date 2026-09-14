const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.join(__dirname, '..', '..');
const hookPath = path.join(repositoryRoot, '.githooks', 'pre-commit');
const isGitWorktree = fs.existsSync(path.join(repositoryRoot, '.git'));

function git(...args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

test('pre-commit 钩子存在，并且真的会跑测试', () => {
  // 光有一个钩子文件、里面什么都不跑，是纯粹的装饰。
  assert.ok(fs.existsSync(hookPath), '缺少 .githooks/pre-commit');
  const text = fs.readFileSync(hookPath, 'utf8');
  assert.match(text, /^#!\/bin\/sh/, '钩子由 sh 执行，shebang 必须是 /bin/sh。');
  assert.match(text, /npm test/, '钩子必须真的跑测试，否则挡不住任何东西。');
});

test('钩子文件里没有 CR 字符', () => {
  // 这台开发机 core.autocrlf=true。检出时若把换行转成 CRLF，shebang 会变成
  // "#!/bin/sh\r"，sh 会去找一个叫 "/bin/sh\r" 的解释器并报 bad interpreter，
  // 钩子就静默失效了。
  const bytes = fs.readFileSync(hookPath);
  assert.ok(!bytes.includes(Buffer.from('\r')), '钩子文件必须用 LF 换行。');
});

test('.gitattributes 明确禁止转换 .githooks 下的换行', () => {
  const attributesPath = path.join(repositoryRoot, '.gitattributes');
  assert.ok(fs.existsSync(attributesPath), '缺少 .gitattributes，CRLF 会破坏钩子。');
  const attributes = fs.readFileSync(attributesPath, 'utf8');
  assert.match(
    attributes,
    /^\.githooks\/\*\* -text$/m,
    '.githooks 下的文件必须标成 -text，否则 autocrlf 会把钩子转成 CRLF。'
  );
});

test('package.json 通过 prepare 自动配置钩子路径', () => {
  // core.hooksPath 是本地配置，克隆下来不会自带。挂在 prepare 上，
  // npm install / npm ci 之后钩子就自动生效了。
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(
    manifest.scripts.prepare || '',
    /install-git-hooks\.js/,
    'prepare 没有配置钩子，新克隆出来的仓库不会跑 pre-commit。'
  );
});

test('当前工作区已经把 core.hooksPath 指向 .githooks', { skip: !isGitWorktree }, () => {
  let value = '';
  try {
    value = git('config', '--get', 'core.hooksPath');
  } catch {
    value = '';
  }
  assert.equal(
    value,
    '.githooks',
    '钩子目录没配上。执行 node tools/install-git-hooks.js，或重新 npm install。'
  );
});

test('钩子在 git 索引里的权限位是可执行的', { skip: !isGitWorktree }, () => {
  // Windows 上 git 不看权限位，但 macOS 和 Linux 上会：没有可执行位，
  // 钩子会被直接忽略，而本地又测不出来。
  const entry = git('ls-files', '-s', '.githooks/pre-commit');
  assert.match(entry, /^100755 /, '钩子文件的可执行位丢了，POSIX 上会被忽略。');
});
