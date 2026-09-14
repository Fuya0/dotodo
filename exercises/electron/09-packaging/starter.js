/**
 * 练习 09：安装器与发布产物的纯逻辑（请手写实现）
 *
 * 这些函数不依赖 Electron，也不碰文件系统和注册表，所以能在 Node 里直接穷举。
 * 它们对应的是真实发布流程里最容易写错、也最值得单独测的几段判断。
 */

function buildSilentInstallArguments(target) {
  throw new Error('请实现 buildSilentInstallArguments');
}

function parseQuietUninstallCommand(commandLine) {
  throw new Error('请实现 parseQuietUninstallCommand');
}

function selectUninstallEntry(entries, productName) {
  throw new Error('请实现 selectUninstallEntry');
}

function classifyPackagedFile(relativePath) {
  throw new Error('请实现 classifyPackagedFile');
}

function summarizePackagedSize(files) {
  throw new Error('请实现 summarizePackagedSize');
}

function compareVersions(left, right) {
  throw new Error('请实现 compareVersions');
}

module.exports = {
  buildSilentInstallArguments,
  parseQuietUninstallCommand,
  selectUninstallEntry,
  classifyPackagedFile,
  summarizePackagedSize,
  compareVersions
};
