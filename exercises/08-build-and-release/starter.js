/**
 * 练习 08：仓库分类与构建产物的纯逻辑（请手写实现）
 *
 * 规则：下面的函数都不依赖 Electron 和文件系统，所以你可以在 Node 里直接跑测试。
 */

function expandArtifactName(pattern, values) {
  throw new Error('请实现 expandArtifactName');
}

function flattenTargets(config) {
  throw new Error('请实现 flattenTargets');
}

function compareSizes(baseline, current) {
  throw new Error('请实现 compareSizes');
}

function sortArtifactsBySize(artifacts) {
  throw new Error('请实现 sortArtifactsBySize');
}

function classifyTrackedFile(relativePath) {
  throw new Error('请实现 classifyTrackedFile');
}

function summarizeReleasePlan(planned, produced) {
  throw new Error('请实现 summarizeReleasePlan');
}

module.exports = {
  expandArtifactName,
  flattenTargets,
  compareSizes,
  sortArtifactsBySize,
  classifyTrackedFile,
  summarizeReleasePlan
};
