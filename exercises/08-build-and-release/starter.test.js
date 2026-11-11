const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expandArtifactName,
  flattenTargets,
  compareSizes,
  sortArtifactsBySize,
  classifyTrackedFile,
  summarizeReleasePlan
} = require('./starter');

/* ---------- 1. expandArtifactName ---------- */

test('expandArtifactName 替换全部已知占位符', () => {
  assert.equal(
    expandArtifactName('DoTodo-Setup-${version}-${arch}.${ext}', { version: '1.0.0', arch: 'x64', ext: 'exe' }),
    'DoTodo-Setup-1.0.0-x64.exe'
  );
  assert.equal(expandArtifactName('${a}-${a}', { a: 'x' }), 'x-x');
  assert.equal(expandArtifactName('DoTodo-${version}-${arch}.${ext}', { version: '1.0.0', arch: 'arm64', ext: 'dmg' }),
    'DoTodo-1.0.0-arm64.dmg');
});

test('expandArtifactName 保留未知占位符，不替换成空字符串', () => {
  assert.equal(expandArtifactName('a-${unknown}-b', {}), 'a-${unknown}-b');
  assert.equal(expandArtifactName('${keep}-${drop}', { drop: 'D' }), '${keep}-D');
  assert.equal(expandArtifactName('no-placeholder', { x: '1' }), 'no-placeholder');
});

test('expandArtifactName 对非字符串和缺失的取值表有确定行为', () => {
  assert.equal(expandArtifactName(null, { a: '1' }), '');
  assert.equal(expandArtifactName(undefined, {}), '');
  assert.equal(expandArtifactName('${a}', undefined), '${a}');
  assert.equal(expandArtifactName('${a}', null), '${a}');
});

/* ---------- 2. flattenTargets ---------- */

test('flattenTargets 把单个对象和数组配置展开成同样的形状', () => {
  assert.deepEqual(flattenTargets({ target: 'nsis', arch: ['x64'] }), [{ target: 'nsis', arch: 'x64' }]);
  assert.deepEqual(flattenTargets([
    { target: 'dmg', arch: ['x64', 'arm64'] },
    { target: 'zip', arch: ['arm64'] }
  ]), [
    { target: 'dmg', arch: 'x64' },
    { target: 'dmg', arch: 'arm64' },
    { target: 'zip', arch: 'arm64' }
  ]);
});

test('flattenTargets 处理缺失的 arch、无效条目和空输入', () => {
  assert.deepEqual(flattenTargets({ target: 'nsis' }), [{ target: 'nsis', arch: null }]);
  assert.deepEqual(flattenTargets({ target: 'nsis', arch: [] }), [{ target: 'nsis', arch: null }]);
  assert.deepEqual(flattenTargets([{ arch: ['x64'] }, { target: 'zip', arch: ['x64'] }]), [
    { target: 'zip', arch: 'x64' }
  ]);
  assert.deepEqual(flattenTargets(undefined), []);
  assert.deepEqual(flattenTargets(null), []);
});

/* ---------- 3. compareSizes ---------- */

test('compareSizes 给出字节差、百分比和结论', () => {
  assert.deepEqual(compareSizes(100, 80), { deltaBytes: -20, deltaPercent: -20, verdict: 'smaller' });
  assert.deepEqual(compareSizes(100, 100), { deltaBytes: 0, deltaPercent: 0, verdict: 'same' });
  assert.deepEqual(compareSizes(100, 150), { deltaBytes: 50, deltaPercent: 50, verdict: 'larger' });
});

test('compareSizes 的百分比保留一位小数', () => {
  assert.deepEqual(compareSizes(3, 4), { deltaBytes: 1, deltaPercent: 33.3, verdict: 'larger' });
  assert.deepEqual(compareSizes(1000, 999), { deltaBytes: -1, deltaPercent: -0.1, verdict: 'smaller' });
});

test('compareSizes 在基准为零时不断言百分比，对非法输入返回 unknown', () => {
  assert.deepEqual(compareSizes(0, 100), { deltaBytes: 100, deltaPercent: null, verdict: 'larger' });
  assert.deepEqual(compareSizes(0, 0), { deltaBytes: 0, deltaPercent: null, verdict: 'same' });
  assert.equal(compareSizes(100, -5).verdict, 'unknown');
  assert.equal(compareSizes(Number.NaN, 10).verdict, 'unknown');
  assert.equal(compareSizes('100', 10).verdict, 'unknown');
});

/* ---------- 4. sortArtifactsBySize ---------- */

test('sortArtifactsBySize 按体积从大到小排序且不修改输入', () => {
  const artifacts = [
    { name: 'a', size: 10 },
    { name: 'b', size: 30 },
    { name: 'c', size: 20 }
  ];
  const sorted = sortArtifactsBySize(artifacts);
  assert.deepEqual(sorted.map((item) => item.name), ['b', 'c', 'a']);
  assert.deepEqual(artifacts.map((item) => item.name), ['a', 'b', 'c']);
  assert.notEqual(sorted, artifacts);
});

test('sortArtifactsBySize 把无效体积当作 0，空输入返回空数组', () => {
  assert.deepEqual(sortArtifactsBySize([
    { name: 'missing' },
    { name: 'bad', size: 'big' },
    { name: 'ok', size: 5 }
  ]).map((item) => item.name), ['ok', 'missing', 'bad']);
  assert.deepEqual(sortArtifactsBySize([]), []);
  assert.deepEqual(sortArtifactsBySize(null), []);
});

/* ---------- 5. classifyTrackedFile ---------- */

test('classifyTrackedFile 按顶层目录归类', () => {
  assert.equal(classifyTrackedFile('src/main.js'), 'source');
  assert.equal(classifyTrackedFile('test/domain/state-schema.test.js'), 'test');
  assert.equal(classifyTrackedFile('.github/workflows/release.yml'), 'packaging');
  assert.equal(classifyTrackedFile('build/icon.svg'), 'packaging');
  assert.equal(classifyTrackedFile('tools/run-smoke.js'), 'packaging');
  assert.equal(classifyTrackedFile('package.json'), 'packaging');
  assert.equal(classifyTrackedFile('CONTEXT.md'), 'docs');
});

test('classifyTrackedFile 优先识别生成的产物，并兼容反斜杠路径', () => {
  assert.equal(classifyTrackedFile('docs/design-notes.md'), 'docs');
  assert.equal(classifyTrackedFile('release/win-unpacked/DoTodo.exe'), 'generated');
  assert.equal(classifyTrackedFile('node_modules/electron/index.js'), 'generated');
  assert.equal(classifyTrackedFile('src\\renderer\\app.js'), 'source');
  assert.equal(classifyTrackedFile(''), 'unknown');
  assert.equal(classifyTrackedFile(undefined), 'unknown');
});

/* ---------- 6. summarizeReleasePlan ---------- */

test('summarizeReleasePlan 区分已产出与缺失的产物', () => {
  assert.deepEqual(
    summarizeReleasePlan(
      ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-x64.dmg', 'DoTodo-1.0.0-arm64.dmg'],
      ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-arm64.dmg']
    ),
    {
      built: ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-arm64.dmg'],
      missing: ['DoTodo-1.0.0-x64.dmg'],
      unexpected: []
    }
  );
});

test('summarizeReleasePlan 报出计划之外的产物', () => {
  assert.deepEqual(
    summarizeReleasePlan(['a.exe'], ['a.exe', 'b.zip', 'c.dmg']),
    { built: ['a.exe'], missing: [], unexpected: ['b.zip', 'c.dmg'] }
  );
});

test('summarizeReleasePlan 对空输入和非数组给出空结果', () => {
  const empty = { built: [], missing: [], unexpected: [] };
  assert.deepEqual(summarizeReleasePlan([], []), empty);
  assert.deepEqual(summarizeReleasePlan(null, undefined), empty);
  assert.deepEqual(summarizeReleasePlan(['a'], null), { built: [], missing: ['a'], unexpected: [] });
});
