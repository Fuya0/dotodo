/**
 * 练习 06：原生壳层的纯逻辑（请手写实现）
 *
 * 规则：下面的函数都不依赖 Electron，所以你可以在 Node 里直接跑测试。
 * 请只使用 JavaScript 标准能力，不要 require 任何模块。
 */

function planTrayMenu(settings) {
  throw new Error('请实现 planTrayMenu');
}

function shouldHideOnClose(state) {
  throw new Error('请实现 shouldHideOnClose');
}

function reconcileLaunchAtLogin(requested, effective) {
  throw new Error('请实现 reconcileLaunchAtLogin');
}

function describeWindowMode(platform, mode) {
  throw new Error('请实现 describeWindowMode');
}

function formatShortcut(accelerator, platform) {
  throw new Error('请实现 formatShortcut');
}

function summarizeShellBoot(result) {
  throw new Error('请实现 summarizeShellBoot');
}

module.exports = {
  planTrayMenu,
  shouldHideOnClose,
  reconcileLaunchAtLogin,
  describeWindowMode,
  formatShortcut,
  summarizeShellBoot
};
