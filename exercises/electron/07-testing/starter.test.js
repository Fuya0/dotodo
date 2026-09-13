const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFileError,
  summarizeVerification,
  formatBytes,
  chooseRecoverySource,
  buildSmokeEnvironment,
  countByExtension
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
