const fs = require('node:fs');
const path = require('node:path');
const { buildDemoState } = require('../../tools/capture-window');

/**
 * 最小窗口尺寸（330×420）。
 *
 * 这是一个悬浮小窗，用户随时可以把它缩到最小。布局溢出是这里最容易回归的一类问题：
 * 多一个按钮、长一点的状态标签、宽一点的间距，都会让某一行在窄窗口下横向撑破。
 *
 * 宽窗口几乎不可能溢出（内容都在 720px 以内），所以只测最小尺寸这一个极端。
 * 拖拽缩放本身仍然只能人工验——渲染进程改不了操作系统窗口的大小。
 */
module.exports = {
  fixture() {
    const state = buildDemoState();
    state.windowBounds = { width: 330, height: 420 };
    return state;
  },

  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    // 场景只读、不改数据，所以磁盘上应该还是原样那 9 条。
    record('场景没有意外改动数据', saved.activeDay?.tasks?.length === 9, `${saved.activeDay?.tasks?.length} 条`);
    record('窗口尺寸被记录成最小值', saved.windowBounds?.width === 330 && saved.windowBounds?.height === 420,
      JSON.stringify(saved.windowBounds));

    return results;
  }
};
