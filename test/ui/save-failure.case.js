const fs = require('node:fs');
const path = require('node:path');

/**
 * 保存失败：数据目录里的 state.json 变成只读。
 *
 * 验收清单第 10.1 节。这是「看着能用，其实什么都没存」那条最危险的路径，
 * 所以它要满足三件事，缺一不可：
 *
 *   1. 用户**当场**被告知保存失败，而不是等下次启动发现数据没了；
 *   2. 已经加进内存的任务**仍然留在界面上**——不能因为写盘失败就把用户刚打的字吞掉；
 *   3. 磁盘上的文件**一个字都没被改**，不能出现写了一半的 JSON。
 *
 * 在 Windows 上把文件设为只读，原子重命名的目标就不可覆盖（EPERM），
 * 于是可以稳定地复现"磁盘写不进去"。
 */
module.exports = {
  fixture() {
    // 用默认演示存档，但 prepare 里会把它锁成只读。
    const { buildDemoState } = require('../../tools/capture-window');
    return buildDemoState();
  },

  prepare(userData) {
    const statePath = path.join(userData, 'state.json');
    this.originalContent = fs.readFileSync(statePath, 'utf8');
    fs.chmodSync(statePath, 0o444);
  },

  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });
    const statePath = path.join(userData, 'state.json');

    const onDisk = fs.readFileSync(statePath, 'utf8');
    record('磁盘上的文件一个字都没变', onDisk === this.originalContent, `${onDisk.length} 字节`);
    record('磁盘上没有被写进新任务', !onDisk.includes('写不进磁盘的任务'));

    let parsed = null;
    try {
      parsed = JSON.parse(onDisk);
    } catch (error) {
      record('磁盘上的仍然是一份完整合法的 JSON（没有写一半）', false, error.message);
    }
    if (parsed) {
      record('磁盘上的仍然是一份完整合法的 JSON（没有写一半）',
        parsed.schemaVersion === 1 && Array.isArray(parsed.activeDay?.tasks));
      record('磁盘上的任务数还是原来那 9 条', parsed.activeDay?.tasks?.length === 9,
        `${parsed.activeDay?.tasks?.length} 条`);
    }

    const leftovers = fs.readdirSync(userData).filter((entry) => entry.endsWith('.tmp'));
    record('失败之后没有留下临时文件', leftovers.length === 0, JSON.stringify(leftovers));

    // 还原权限，免得临时目录清理时删不掉。
    try {
      fs.chmodSync(statePath, 0o666);
    } catch {
      // 清理失败不影响断言结果。
    }

    return results;
  }
};
