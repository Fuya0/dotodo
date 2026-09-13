/**
 * 练习 07：验证与恢复的纯逻辑（请手写实现）
 *
 * 规则：下面的函数都不依赖 Electron 和文件系统，所以你可以在 Node 里直接跑测试。
 */

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

module.exports = {
  classifyFileError,
  summarizeVerification,
  formatBytes,
  chooseRecoverySource,
  buildSmokeEnvironment,
  countByExtension
};
