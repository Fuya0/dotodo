const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSilentInstallArguments,
  parseQuietUninstallCommand,
  selectUninstallEntry,
  classifyPackagedFile,
  summarizePackagedSize,
  compareVersions
} = require('./starter');

/* ---------- 1. buildSilentInstallArguments ---------- */

test('buildSilentInstallArguments 拼出 /S 与放在末尾的 /D=', () => {
  assert.equal(
    buildSilentInstallArguments('C:\\Users\\me\\Temp\\dotodo'),
    '/S /D=C:\\Users\\me\\Temp\\dotodo'
  );
  // 路径里有空格也不需要加引号：/D= 后面整行都是路径。
  assert.equal(
    buildSilentInstallArguments('C:\\Program Files\\DoTodo'),
    '/S /D=C:\\Program Files\\DoTodo'
  );
  // UNC 路径和 POSIX 绝对路径同样接受。
  assert.equal(
    buildSilentInstallArguments('\\\\server\\share\\DoTodo'),
    '/S /D=\\\\server\\share\\DoTodo'
  );
  assert.equal(buildSilentInstallArguments('/tmp/dotodo'), '/S /D=/tmp/dotodo');
});

test('buildSilentInstallArguments 去掉末尾多余分隔符，但保留盘符根', () => {
  assert.equal(buildSilentInstallArguments('C:\\a\\b\\'), '/S /D=C:\\a\\b');
  assert.equal(buildSilentInstallArguments('C:\\a\\b\\\\'), '/S /D=C:\\a\\b');
  assert.equal(buildSilentInstallArguments('/tmp/dotodo/'), '/S /D=/tmp/dotodo');
  // C:\ 去掉末尾分隔符会变成 C:，那不是一个位置，所以要保留。
  assert.equal(buildSilentInstallArguments('C:\\'), '/S /D=C:\\');
});

test('buildSilentInstallArguments 拒绝相对路径和空值', () => {
  assert.equal(buildSilentInstallArguments('relative\\path'), null);
  assert.equal(buildSilentInstallArguments('C:'), null);
  assert.equal(buildSilentInstallArguments(''), null);
  assert.equal(buildSilentInstallArguments('   '), null);
  assert.equal(buildSilentInstallArguments(null), null);
  assert.equal(buildSilentInstallArguments(undefined), null);
  assert.equal(buildSilentInstallArguments(42), null);
});

/* ---------- 2. parseQuietUninstallCommand ---------- */

test('parseQuietUninstallCommand 拆出可执行文件与参数', () => {
  assert.deepEqual(
    parseQuietUninstallCommand('"C:\\Temp\\probe\\Uninstall DoTodo.exe" /currentuser /S'),
    { executable: 'C:\\Temp\\probe\\Uninstall DoTodo.exe', arguments: '/currentuser /S' }
  );
  // 没有参数时给空字符串，而不是 undefined。
  assert.deepEqual(
    parseQuietUninstallCommand('"C:\\Temp\\probe\\Uninstall DoTodo.exe"'),
    { executable: 'C:\\Temp\\probe\\Uninstall DoTodo.exe', arguments: '' }
  );
  // 参数两侧多余的空白要去掉。
  assert.deepEqual(
    parseQuietUninstallCommand('"C:\\u.exe"    /S   '),
    { executable: 'C:\\u.exe', arguments: '/S' }
  );
});

test('parseQuietUninstallCommand 拒绝没有用引号包住路径的命令行', () => {
  // 路径没加引号时，中间的空格到底属于路径还是参数无法判断。
  // 与其猜一个，不如说"我解析不了"。
  assert.equal(parseQuietUninstallCommand('C:\\a\\u.exe /S'), null);
  assert.equal(parseQuietUninstallCommand('"C:\\a\\u.exe'), null);
  assert.equal(parseQuietUninstallCommand('""'), null);
  assert.equal(parseQuietUninstallCommand(''), null);
  assert.equal(parseQuietUninstallCommand('   '), null);
  assert.equal(parseQuietUninstallCommand(null), null);
  assert.equal(parseQuietUninstallCommand(undefined), null);
});

/* ---------- 3. selectUninstallEntry ---------- */

test('selectUninstallEntry 只挑出本产品，且不允许前缀误伤', () => {
  const entries = [
    { DisplayName: 'DoTodo 1.0.0' },
    { DisplayName: 'DoTodoHelper 1.0' },
    { DisplayName: 'DoTodo' },
    { DisplayName: 'DoTodoX' },
    { DisplayName: 'dotodo 1.0' },
    { DisplayName: 'Other' }
  ];
  // 值由安装器写进注册表，形态是「productName」或「productName 版本号」。
  // 关键是后面必须跟一个空格：DoTodoHelper 是另一个产品，不能算进来。
  assert.deepEqual(selectUninstallEntry(entries, 'DoTodo'), [
    { DisplayName: 'DoTodo 1.0.0' },
    { DisplayName: 'DoTodo' }
  ]);
});

test('selectUninstallEntry 对名称里的正则元字符做转义', () => {
  const entries = [{ DisplayName: 'DoXTodo 1.0' }, { DisplayName: 'Do.Todo 2.0' }];
  // 把 productName 直接拼进正则而不转义的话，'.' 会匹配任意字符，
  // DoXTodo 就会被误当成 Do.Todo 的另一套安装 —— 卸载时删错东西。
  assert.deepEqual(selectUninstallEntry(entries, 'Do.Todo'), [{ DisplayName: 'Do.Todo 2.0' }]);
});

test('selectUninstallEntry 忽略结构不合法的条目', () => {
  const entries = [
    null,
    'DoTodo 1.0.0',
    { DisplayName: 123 },
    { DisplayName: '' },
    { Other: 'field' },
    { DisplayName: 'DoTodo 1.0.0' }
  ];
  assert.deepEqual(selectUninstallEntry(entries, 'DoTodo'), [{ DisplayName: 'DoTodo 1.0.0' }]);
  assert.deepEqual(selectUninstallEntry(entries), []);
  assert.deepEqual(selectUninstallEntry([], 'DoTodo'), []);
  assert.deepEqual(selectUninstallEntry(null, 'DoTodo'), []);
});

/* ---------- 4. classifyPackagedFile ---------- */

test('classifyPackagedFile 前缀规则优先于扩展名', () => {
  assert.equal(classifyPackagedFile('locales/en-US.pak'), 'locales');
  assert.equal(classifyPackagedFile('resources/app.asar'), 'resources');
  // resources.pak 不在 resources/ 目录里，所以按扩展名分类。
  assert.equal(classifyPackagedFile('resources.pak'), 'pak');
});

test('classifyPackagedFile 覆盖每个分类，扩展名不区分大小写', () => {
  assert.equal(classifyPackagedFile('DoTodo.exe'), 'exe');
  assert.equal(classifyPackagedFile('DoTodo.EXE'), 'exe');
  assert.equal(classifyPackagedFile('ffmpeg.dll'), 'dll');
  assert.equal(classifyPackagedFile('icudtl.DAT'), 'v8-icu');
  assert.equal(classifyPackagedFile('snapshot_blob.bin'), 'v8-icu');
  assert.equal(classifyPackagedFile('v8_context_snapshot.bin'), 'v8-icu');
  assert.equal(classifyPackagedFile('chrome_100_percent.pak'), 'pak');
  assert.equal(classifyPackagedFile('package.json'), 'config');
  assert.equal(classifyPackagedFile('LICENSE.electron.txt'), 'other');
});

test('classifyPackagedFile 把反斜杠当分隔符，认不出的归 other', () => {
  assert.equal(classifyPackagedFile('resources\\app.asar'), 'resources');
  assert.equal(classifyPackagedFile('locales\\en-US.pak'), 'locales');
  assert.equal(classifyPackagedFile('DoTodo'), 'other');
  assert.equal(classifyPackagedFile(''), 'other');
  assert.equal(classifyPackagedFile(null), 'other');
  assert.equal(classifyPackagedFile(undefined), 'other');
});

/* ---------- 5. summarizePackagedSize ---------- */

test('summarizePackagedSize 按体积降序汇总并给出占比', () => {
  const summary = summarizePackagedSize([
    { relativePath: 'DoTodo.exe', size: 100 },
    { relativePath: 'locales/en-US.pak', size: 50 },
    { relativePath: 'resources/app.asar', size: 30 },
    { relativePath: 'ffmpeg.dll', size: 20 }
  ]);
  assert.equal(summary.total, 200);
  assert.deepEqual(summary.groups, [
    { category: 'exe', bytes: 100, count: 1, share: 50 },
    { category: 'locales', bytes: 50, count: 1, share: 25 },
    { category: 'resources', bytes: 30, count: 1, share: 15 },
    { category: 'dll', bytes: 20, count: 1, share: 10 }
  ]);
});

test('summarizePackagedSize 同一分类合并计数，占比保留一位小数', () => {
  const summary = summarizePackagedSize([
    { relativePath: 'a.dll', size: 1 },
    { relativePath: 'b.dll', size: 1 },
    { relativePath: 'c.pak', size: 1 }
  ]);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.groups, [
    { category: 'dll', bytes: 2, count: 2, share: 66.7 },
    { category: 'pak', bytes: 1, count: 1, share: 33.3 }
  ]);
});

test('summarizePackagedSize 体积相同时按类别名升序，保证顺序是确定的', () => {
  // 只按体积排序的话，并列的顺序会取决于输入顺序（或引擎的排序稳定性），
  // 同一个输入换个顺序就得到不同的输出，测试和界面上都会飘。
  const summary = summarizePackagedSize([
    { relativePath: 'x.pak', size: 10 },
    { relativePath: 'y.exe', size: 10 },
    { relativePath: 'z.dll', size: 10 }
  ]);
  assert.deepEqual(summary.groups.map((group) => group.category), ['dll', 'exe', 'pak']);
});

test('summarizePackagedSize 处理空输入和缺失体积', () => {
  assert.deepEqual(summarizePackagedSize([]), { total: 0, groups: [] });
  assert.deepEqual(summarizePackagedSize(null), { total: 0, groups: [] });
  assert.deepEqual(summarizePackagedSize(undefined), { total: 0, groups: [] });

  const summary = summarizePackagedSize([
    { relativePath: 'a.exe', size: undefined },
    { relativePath: 'b.exe' },
    { relativePath: 'c.exe', size: -5 },
    { relativePath: 'd.exe', size: 'big' }
  ]);
  // 体积拿不到就按 0 算，但不能因此把这一项整个丢掉 —— 文件确实在包里。
  assert.deepEqual(summary.groups, [
    { category: 'exe', bytes: 0, count: 4, share: 0 }
  ]);
});

/* ---------- 6. compareVersions ---------- */

test('compareVersions 按数字段比较，而不是按字符串', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  // 字符串比较会认为 '1.9.0' 更大（'9' > '1'），那就把升级判断反过来了。
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('2', '1.9.9'), 1);
});

test('compareVersions 缺段补 0', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0'), 0);
  assert.equal(compareVersions('1.2.1', '1.2'), 1);
  assert.equal(compareVersions('1.2', '1.2.1'), -1);
});

test('compareVersions 拒绝不是版本号的输入', () => {
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), null);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), null);
  assert.equal(compareVersions('', '1.0.0'), null);
  assert.equal(compareVersions('1..0', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', '1.0.0 '), null);
  assert.equal(compareVersions(1.0, '1.0.0'), null);
  assert.equal(compareVersions(null, null), null);
});
