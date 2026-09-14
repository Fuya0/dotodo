const fs = require('node:fs');
const path = require('node:path');

/**
 * 主文件和备份都损坏——最坏的情况。
 *
 * 这时已经没有任何数据可以恢复，所以这条路径要守的不是"救回清单"，而是两件别的事：
 *
 *   1. **两份坏文件都要被完整保留下来。** 用户拿去手动抢救的唯一希望就是它们；
 *      如果不留证据，应用等于替用户决定了"这些数据不要了"。
 *   2. **应用要照常启动并可用**，只是清单是空的。不能因为读不出数据就起不来。
 *
 * 验收清单第 9.8 节。
 */
module.exports = {
  fixture: () => null,

  prepare(userData) {
    fs.writeFileSync(path.join(userData, 'state.json'), '{broken primary', 'utf8');
    fs.writeFileSync(path.join(userData, 'state.backup.json'), 'not json at all', 'utf8');
  },

  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    const entries = fs.readdirSync(userData);
    const primaryRecovery = entries.filter((entry) => entry.startsWith('recovery-primary-'));
    const backupRecovery = entries.filter((entry) => entry.startsWith('recovery-backup-'));

    record('主文件的坏数据被保留了', primaryRecovery.length === 1, JSON.stringify(entries));
    if (primaryRecovery.length === 1) {
      record('保留的主文件是一字不差的原文',
        fs.readFileSync(path.join(userData, primaryRecovery[0]), 'utf8') === '{broken primary');
    }

    // 坏备份会被保留两次：一次在 load() 发现它的时候，一次在随后的 save() 轮转备份、
    // 再次读到这份坏文件的时候。第二次之后备份就被合法内容覆盖了，所以总数有界。
    // 真正的保证是「每一份保留文件都一字不差」，而不是「只保留一份」。
    record('备份的坏数据被保留了', backupRecovery.length >= 1, JSON.stringify(entries));
    record('每一份保留的备份都是原文',
      backupRecovery.length > 0 &&
        backupRecovery.every((entry) => fs.readFileSync(path.join(userData, entry), 'utf8') === 'not json at all'),
      JSON.stringify(backupRecovery));

    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    } catch (error) {
      record('两份都坏之后仍然写出了一个合法的空状态', false, error.message);
      return results;
    }
    record('新的状态文件是合法的', saved.schemaVersion === 1, String(saved.schemaVersion));
    // 场景最后一步加了一条任务，用来证明应用仍然能用。除了它以外不该有任何任务。
    const texts = (saved.activeDay?.tasks ?? []).map((task) => task.text);
    record('没有从坏文件里恢复出任何东西',
      texts.length === 1 && texts[0] === '从空清单重新开始',
      JSON.stringify(texts));
    record('没有凭空编造历史', Array.isArray(saved.history) && saved.history.length === 0);

    const leftovers = entries.filter((entry) => entry.endsWith('.tmp'));
    record('没有留下写了一半的临时文件', leftovers.length === 0, JSON.stringify(leftovers));

    return results;
  }
};
