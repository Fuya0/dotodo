const fs = require('node:fs');
const path = require('node:path');
const { buildDemoState } = require('../../tools/capture-window');

/**
 * 主状态文件损坏、备份完好。
 *
 * 这是验收清单第 9.7 节，也是整个项目里最接近"数据丢了"的一条路径。它要同时满足两件事：
 *
 *   1. **证据不能丢**：坏掉的原文件必须被完整复制到 recovery-*.json，而不是直接覆盖；
 *   2. **用户不能丢数据**：清单要从备份恢复出来，应用照常能用。
 *
 * 只满足第 2 条是不够的——那等于用"看起来没事"掩盖了一次真实的数据损坏。
 */
module.exports = {
  // 不写正常存档，下面 prepare 自己造现场。
  fixture: () => null,

  prepare(userData) {
    fs.writeFileSync(path.join(userData, 'state.json'), '{broken', 'utf8');
    fs.writeFileSync(
      path.join(userData, 'state.backup.json'),
      `${JSON.stringify(buildDemoState(), null, 2)}\n`,
      'utf8'
    );
  },

  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    const recoveryFiles = fs.readdirSync(userData).filter((entry) => entry.startsWith('recovery-primary-'));

    record('留下了 recovery-primary 文件', recoveryFiles.length === 1, JSON.stringify(recoveryFiles));
    if (recoveryFiles.length === 1) {
      const preserved = fs.readFileSync(path.join(userData, recoveryFiles[0]), 'utf8');
      record('保留的正是那份坏数据（一字不差）', preserved === '{broken', JSON.stringify(preserved));
    }

    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    } catch (error) {
      record('恢复之后 state.json 是合法 JSON', false, error.message);
      return results;
    }

    // 场景最后一步加了一条任务（证明恢复之后应用仍然可用），所以总数是 10 而不是 9。
    record('从备份恢复出了原来那 9 条任务',
      saved.activeDay?.tasks?.filter((task) => task.text !== '恢复之后还能正常添加').length === 9,
      `${saved.activeDay?.tasks?.length} 条`);
    record('恢复之后新增的任务被正常保存',
      saved.activeDay?.tasks?.some((task) => task.text === '恢复之后还能正常添加'),
      JSON.stringify(saved.activeDay?.tasks?.map((t) => t.text)));
    record('恢复出来的状态是合法 schema', saved.schemaVersion === 1, String(saved.schemaVersion));
    record('没有把坏数据当成空清单', saved.activeDay?.tasks?.length > 0);

    const leftovers = fs.readdirSync(userData).filter((entry) => entry.endsWith('.tmp'));
    record('没有留下写了一半的临时文件', leftovers.length === 0, JSON.stringify(leftovers));

    return results;
  }
};
