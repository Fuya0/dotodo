const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFileError,
  summarizeVerification,
  formatBytes,
  chooseRecoverySource,
  buildSmokeEnvironment,
  countByExtension,
  isScenarioFile,
  extractDriveResult,
  summarizeScenarios,
  withinDeadline,
  fitsInside,
  diffFileNames
} = require('./starter');

/* ---------- 1. classifyFileError ---------- */

test('classifyFileError 按系统错误码分类', () => {
  assert.equal(classifyFileError({ code: 'ENOENT' }), 'missing');
  assert.equal(classifyFileError({ code: 'EACCES' }), 'denied');
  assert.equal(classifyFileError({ code: 'EPERM' }), 'denied');
  assert.equal(classifyFileError({ code: 'ENOSPC' }), 'full');
});

test('classifyFileError 对未知和空输入回落到 unknown', () => {
  assert.equal(classifyFileError({ code: 'EWHATEVER' }), 'unknown');
  assert.equal(classifyFileError({}), 'unknown');
  assert.equal(classifyFileError(null), 'unknown');
  assert.equal(classifyFileError(undefined), 'unknown');
  assert.equal(classifyFileError('ENOENT'), 'unknown');
});

/* ---------- 2. summarizeVerification ---------- */

test('summarizeVerification 汇总每一步的状态', () => {
  assert.deepEqual(summarizeVerification([
    { name: '单元测试', status: 'passed' },
    { name: '冒烟测试', status: 'failed' },
    { name: '打包', status: 'skipped' },
    { name: '体积统计', status: 'passed' }
  ]), {
    total: 4, passed: 2, failed: 1, skipped: 1, ok: false, firstFailure: '冒烟测试'
  });
});

test('summarizeVerification 在没有失败时判定通过', () => {
  assert.deepEqual(summarizeVerification([
    { name: 'a', status: 'passed' },
    { name: 'b', status: 'skipped' }
  ]), {
    total: 2, passed: 1, failed: 0, skipped: 1, ok: true, firstFailure: null
  });
});

test('summarizeVerification 把空输入和非数组当作零步通过', () => {
  const empty = { total: 0, passed: 0, failed: 0, skipped: 0, ok: true, firstFailure: null };
  assert.deepEqual(summarizeVerification([]), empty);
  assert.deepEqual(summarizeVerification(null), empty);
  assert.deepEqual(summarizeVerification(undefined), empty);
});

test('summarizeVerification 只记第一个失败步骤', () => {
  assert.equal(summarizeVerification([
    { name: '先失败', status: 'failed' },
    { name: '后失败', status: 'failed' }
  ]).firstFailure, '先失败');
});

/* ---------- 3. formatBytes ---------- */

test('formatBytes 用 1024 进制换算到合适单位', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(111416252), '106.3 MB');
});

test('formatBytes 处理 GB 以及非有限和负数输入', () => {
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
  assert.equal(formatBytes('123'), '0 B');
});

/* ---------- 4. chooseRecoverySource ---------- */

test('chooseRecoverySource 优先使用主文件', () => {
  assert.deepEqual(chooseRecoverySource({ primary: 'valid', backup: 'valid' }), {
    source: 'primary', preserve: [], reason: 'primary-ok'
  });
  assert.deepEqual(chooseRecoverySource({ primary: 'valid', backup: 'missing' }), {
    source: 'primary', preserve: [], reason: 'primary-ok'
  });
  assert.deepEqual(chooseRecoverySource({ primary: 'valid', backup: 'corrupt' }), {
    source: 'primary', preserve: ['backup'], reason: 'backup-corrupt'
  });
});

test('chooseRecoverySource 在主文件不可用时改用备份', () => {
  assert.deepEqual(chooseRecoverySource({ primary: 'corrupt', backup: 'valid' }), {
    source: 'backup', preserve: ['primary'], reason: 'primary-corrupt'
  });
  assert.deepEqual(chooseRecoverySource({ primary: 'missing', backup: 'valid' }), {
    source: 'backup', preserve: [], reason: 'primary-missing'
  });
});

test('chooseRecoverySource 在两份都不可用时保留能保留的文件', () => {
  assert.deepEqual(chooseRecoverySource({ primary: 'corrupt', backup: 'corrupt' }), {
    source: 'none', preserve: ['primary', 'backup'], reason: 'nothing-usable'
  });
  assert.deepEqual(chooseRecoverySource({ primary: 'corrupt', backup: 'missing' }), {
    source: 'none', preserve: ['primary'], reason: 'nothing-usable'
  });
  assert.deepEqual(chooseRecoverySource({ primary: 'missing', backup: 'corrupt' }), {
    source: 'none', preserve: ['backup'], reason: 'nothing-usable'
  });
});

test('chooseRecoverySource 把两份都不存在识别为全新开始', () => {
  assert.deepEqual(chooseRecoverySource({ primary: 'missing', backup: 'missing' }), {
    source: 'none', preserve: [], reason: 'fresh'
  });
});

/* ---------- 5. buildSmokeEnvironment ---------- */

test('buildSmokeEnvironment 在保留原有环境的前提下注入隔离目录', () => {
  const result = buildSmokeEnvironment({ PATH: 'C:\\bin', LANG: 'zh-CN' }, 'C:\\tmp\\dotodo-smoke');
  assert.deepEqual(result, {
    ok: true,
    env: { PATH: 'C:\\bin', LANG: 'zh-CN', DOTODO_SMOKE_USER_DATA: 'C:\\tmp\\dotodo-smoke' }
  });
});

test('buildSmokeEnvironment 不修改传入的环境对象', () => {
  const base = { PATH: 'C:\\bin' };
  buildSmokeEnvironment(base, 'C:\\tmp\\x');
  assert.deepEqual(base, { PATH: 'C:\\bin' });
});

test('buildSmokeEnvironment 缺失基础环境时仍然可用', () => {
  assert.deepEqual(buildSmokeEnvironment(undefined, 'C:\\tmp\\x'), {
    ok: true,
    env: { DOTODO_SMOKE_USER_DATA: 'C:\\tmp\\x' }
  });
});

test('buildSmokeEnvironment 拒绝空目录，避免误写真实数据', () => {
  for (const broken of ['', '   ', null, undefined, 42]) {
    const result = buildSmokeEnvironment({ PATH: 'C:\\bin' }, broken);
    assert.equal(result.ok, false, `目录 ${String(broken)} 应该被拒绝。`);
    assert.equal(typeof result.error, 'string');
  }
});

/* ---------- 6. countByExtension ---------- */

test('countByExtension 按小写扩展名归类', () => {
  assert.deepEqual(countByExtension(['a.dll', 'b.dll', 'c.pak', 'd.DLL']), {
    '.dll': 3,
    '.pak': 1
  });
});

test('countByExtension 只取最后一个扩展名', () => {
  assert.deepEqual(countByExtension(['archive.tar.gz', 'plain.txt']), {
    '.gz': 1,
    '.txt': 1
  });
});

test('countByExtension 把没有扩展名的文件单独归类', () => {
  assert.deepEqual(countByExtension(['README', '.gitignore', 'a.dll']), {
    'no-extension': 2,
    '.dll': 1
  });
});

test('countByExtension 对空输入和非数组返回空对象', () => {
  assert.deepEqual(countByExtension([]), {});
  assert.deepEqual(countByExtension(null), {});
  assert.deepEqual(countByExtension(['a', 42, null]), { 'no-extension': 1 });
});

/* ---------- 7. isScenarioFile ---------- */

test('isScenarioFile 只认渲染进程场景', () => {
  assert.equal(isScenarioFile('today.js'), true);
  assert.equal(isScenarioFile('navigation-and-settings.js'), true);
  // 名字以 case.js 结尾，但不是 *.case.js 配对文件。
  assert.equal(isScenarioFile('case.js'), true);
});

test('isScenarioFile 排除前置代码和 Node 侧配对文件', () => {
  assert.equal(isScenarioFile('_prelude.js'), false);
  assert.equal(isScenarioFile('today.case.js'), false);
  assert.equal(isScenarioFile('rollover.case.js'), false);
  assert.equal(isScenarioFile('_x.case.js'), false);
});

test('isScenarioFile 对没有文件名、错大小写和非字符串说不是', () => {
  assert.equal(isScenarioFile('.js'), false, '只有扩展名不算文件名');
  assert.equal(isScenarioFile('README.md'), false);
  assert.equal(isScenarioFile('today.JS'), false, '扩展名大小写敏感');
  assert.equal(isScenarioFile(undefined), false);
  assert.equal(isScenarioFile(42), false);
});

/* ---------- 8. extractDriveResult ---------- */

test('extractDriveResult 从混杂输出里取出结果', () => {
  const stdout = [
    'some noise from electron',
    'DOTODO_SMOKE_READY',
    'DOTODO_DRIVE_RESULT [{"name":"a","passed":true}]',
    '截图已写入 F:\\shots\\today.png'
  ].join('\n');
  assert.deepEqual(extractDriveResult(stdout), [{ name: 'a', passed: true }]);

  assert.deepEqual(extractDriveResult('DOTODO_DRIVE_RESULT {"scenarios":2}'), { scenarios: 2 });
});

test('extractDriveResult 只取第一条结果', () => {
  const stdout = 'DOTODO_DRIVE_RESULT [1]\nDOTODO_DRIVE_RESULT [2]';
  assert.deepEqual(extractDriveResult(stdout), [1]);
});

test('extractDriveResult 对缺失或损坏的标记返回 null', () => {
  assert.equal(extractDriveResult('nothing here'), null);
  assert.equal(extractDriveResult('DOTODO_DRIVE_RESULT '), null);
  assert.equal(extractDriveResult('DOTODO_DRIVE_RESULT {not json}'), null);
  assert.equal(extractDriveResult(''), null);
  assert.equal(extractDriveResult(null), null);
  assert.equal(extractDriveResult(undefined), null);
});

test('extractDriveResult 不会把空数组当成失败', () => {
  // 一个断言都没有的场景返回的是 []，那是合法结果，不是"没收到"。
  assert.deepEqual(extractDriveResult('DOTODO_DRIVE_RESULT []'), []);
});

/* ---------- 9. summarizeScenarios ---------- */

test('summarizeScenarios 汇总场景与断言，并给出退出码', () => {
  assert.deepEqual(summarizeScenarios([
    { name: 'a', checks: [{ passed: true }, { passed: true }] },
    { name: 'b', checks: [{ passed: true }, { passed: false }] },
    { name: 'c', checks: [], error: '跑不起来' }
  ]), {
    scenarios: 3, assertions: 4, passed: 3, failed: 1, broken: 1, exitCode: 1
  });
});

test('summarizeScenarios 全绿时退出码为 0', () => {
  assert.deepEqual(summarizeScenarios([
    { name: 'a', checks: [{ passed: true }] }
  ]), {
    scenarios: 1, assertions: 1, passed: 1, failed: 0, broken: 0, exitCode: 0
  });
});

test('summarizeScenarios 对空输入和非数组返回全零', () => {
  const empty = { scenarios: 0, assertions: 0, passed: 0, failed: 0, broken: 0, exitCode: 0 };
  assert.deepEqual(summarizeScenarios([]), empty);
  assert.deepEqual(summarizeScenarios(null), empty);
  assert.deepEqual(summarizeScenarios(undefined), empty);
});

test('summarizeScenarios 在没有断言但有错误时仍然算失败', () => {
  // 场景连跑都没跑起来：断言数是 0，但绝不能报"通过"。
  assert.deepEqual(summarizeScenarios([{ name: 'a', checks: [], error: '超时' }]), {
    scenarios: 1, assertions: 0, passed: 0, failed: 0, broken: 1, exitCode: 1
  });
});

/* ---------- 10. withinDeadline ---------- */

test('withinDeadline 把到期时刻算作还没超时', () => {
  assert.equal(withinDeadline(0, 0, 100), true);
  assert.equal(withinDeadline(0, 99, 100), true);
  assert.equal(withinDeadline(0, 100, 100), true, '正好到点仍算在窗口内');
  assert.equal(withinDeadline(0, 101, 100), false);
});

test('withinDeadline 对非有限数字一概说超时', () => {
  assert.equal(withinDeadline(0, Number.NaN, 100), false);
  assert.equal(withinDeadline(0, 10, Number.POSITIVE_INFINITY), false);
  assert.equal(withinDeadline('0', 10, 100), false);
  assert.equal(withinDeadline(0, undefined, 100), false);
});

/* ---------- 11. fitsInside ---------- */

test('fitsInside 判断内框是否完全落在外框里', () => {
  const outer = { top: 0, left: 0, right: 378, bottom: 640 };
  assert.equal(fitsInside({ top: 7, left: 7, right: 371, bottom: 60 }, outer), true);
  assert.equal(fitsInside(outer, outer), true, '刚好贴边也算在里面');
  assert.equal(fitsInside({ top: 7, left: 7, right: 400, bottom: 60 }, outer), false, '右边超了');
  assert.equal(fitsInside({ top: -1, left: 7, right: 371, bottom: 60 }, outer), false, '上面超了');
});

test('fitsInside 的容差用来吸收亚像素误差', () => {
  const outer = { top: 0, left: 0, right: 378, bottom: 640 };
  const slightlyOut = { top: 7, left: 7, right: 380, bottom: 60 };
  assert.equal(fitsInside(slightlyOut, outer), false);
  assert.equal(fitsInside(slightlyOut, outer, 4), true);
  assert.equal(fitsInside(slightlyOut, outer, 1), false);
});

test('fitsInside 对缺字段或非数字返回 false', () => {
  const outer = { top: 0, left: 0, right: 378, bottom: 640 };
  assert.equal(fitsInside({}, outer), false);
  assert.equal(fitsInside({ top: 0, left: 0, right: 10 }, outer), false);
  assert.equal(fitsInside({ top: 0, left: 0, right: '10', bottom: 10 }, outer), false);
  assert.equal(fitsInside(null, outer), false);
  assert.equal(fitsInside({ top: 0, left: 0, right: 1, bottom: 1 }, null), false);
});

/* ---------- 12. diffFileNames ---------- */

test('diffFileNames 分出新增、删除和保留的文件', () => {
  assert.deepEqual(diffFileNames(['a', 'b'], ['b', 'c']), {
    added: ['c'],
    removed: ['a'],
    kept: ['b']
  });
});

test('diffFileNames 去重、排序，并对非数组返回空结果', () => {
  // 恢复文件可能被保留不止一份，所以去重比计次更重要。
  assert.deepEqual(diffFileNames(['b', 'a', 'a'], ['b', 'b', 'z']), {
    added: ['z'],
    removed: ['a'],
    kept: ['b']
  });
  const empty = { added: [], removed: [], kept: [] };
  assert.deepEqual(diffFileNames([], []), empty);
  assert.deepEqual(diffFileNames(null, ['a']), { added: ['a'], removed: [], kept: [] });
  assert.deepEqual(diffFileNames(['a'], undefined), { added: [], removed: ['a'], kept: [] });
});
