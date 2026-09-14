const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * 单独一个 `\r`（后面不跟着 `\n`）不是任何一个平台的行尾。
 *
 * 它会带来一个很隐蔽的麻烦：按行处理的工具切不开它，于是那两行在工具眼里粘成
 * 一行 —— 报出来的行号、`git diff` 的上下文、编辑器里看到的都跟实际不是一回事。
 * Node 和浏览器反而都认 `\r` 是换行，代码照样跑，所以这个问题不会自己暴露。
 *
 * 这个仓库就中过：`src/main.js` 和 `test/electron/ipc.test.js` 里各混进了几个。
 */
const SCAN_DIRECTORIES = ['src', 'test', 'tools', 'docs'];
const SCAN_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ps1', '.md'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'release', 'dist', '.git']);

function collectFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectFiles(full));
    else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) found.push(full);
  }
  return found;
}

function findLoneCarriageReturns(text) {
  const lines = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\r' || text[index + 1] === '\n') continue;
    lines.push(text.slice(0, index).split('\n').length);
  }
  return lines;
}

test('源码里没有裸 \\r，否则按行处理的工具会把两行看成一行', () => {
  const offenders = [];
  for (const directory of SCAN_DIRECTORIES) {
    const absolute = path.join(ROOT, directory);
    if (!fs.existsSync(absolute)) continue;
    for (const file of collectFiles(absolute)) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = findLoneCarriageReturns(text);
      if (lines.length > 0) {
        offenders.push(`${path.relative(ROOT, file)}:${lines.join(',')}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `这些文件里有裸 \\r：${offenders.join(' | ')}`);
});

test('这个守卫真的认得出裸 \\r', () => {
  // 守卫本身失效是最糟的情况：它安静地绿着，什么也没检查。
  assert.deepEqual(findLoneCarriageReturns('a\rb\nc'), [1]);
  assert.deepEqual(findLoneCarriageReturns('a\r\nb\rc'), [2]);
  assert.deepEqual(findLoneCarriageReturns('a\r\nb\r\n'), []);
  assert.deepEqual(findLoneCarriageReturns('没有回车'), []);
});
