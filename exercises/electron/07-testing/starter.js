/**
 * 练习 07：验证与恢复的纯逻辑（请手写实现）
 *
 * 规则：下面的函数都不依赖 Electron 和文件系统，所以你可以在 Node 里直接跑测试。
 *
 * 前 6 题来自「验证脚本与数据恢复」，后 6 题来自「交互场景运行器」——
 * 也就是 npm run ui-check 那套东西里可以被纯函数覆盖的部分。
 */

/* ---------- 第一部分：验证与恢复 ---------- */

function classifyFileError(error) {
  throw new Error('请实现 classifyFileError');
}

function summarizeVerification(steps) {
  throw new Error('请实现 summarizeVerification');
}

function formatBytes(bytes) {
  throw new Error('请实现 formatBytes');
}

function chooseRecoverySource(candidates) {
  throw new Error('请实现 chooseRecoverySource');
}

function buildSmokeEnvironment(baseEnv, userDataDirectory) {
  throw new Error('请实现 buildSmokeEnvironment');
}

function countByExtension(files) {
  throw new Error('请实现 countByExtension');
}

/* ---------- 第二部分：交互场景运行器 ---------- */

function isScenarioFile(name) {
  throw new Error('请实现 isScenarioFile');
}

function extractDriveResult(stdout) {
  throw new Error('请实现 extractDriveResult');
}

function summarizeScenarios(results) {
  throw new Error('请实现 summarizeScenarios');
}

function withinDeadline(startedAt, now, timeoutMs) {
  throw new Error('请实现 withinDeadline');
}

function fitsInside(inner, outer, tolerance = 0) {
  throw new Error('请实现 fitsInside');
}

function diffFileNames(before, after) {
  throw new Error('请实现 diffFileNames');
}

module.exports = {
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
};
