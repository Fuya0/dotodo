const fs = require('node:fs');
const path = require('node:path');

/**
 * 拖拽换位之后，顺序必须真的落到磁盘上。
 *
 * 验收清单 2.16 的后半句是「重启后仍然保持」。前面的交互场景只断言了界面上顺序变了，
 * 而"界面上变了、磁盘上没变"正是拖拽最典型的假成功——松手时看着好好的，
 * 下次打开又回去了。
 *
 * 起始顺序是演示数据那 9 条；场景把第 1 行拖到第 3 行，所以磁盘上的期望顺序是
 * 「第 2、3 条，第 1 条，然后其余」。
 */
module.exports = {
  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    } catch (error) {
      record('拖拽之后磁盘上的状态仍然可读', false, error.message);
      return results;
    }

    const texts = (saved.activeDay?.tasks ?? []).map((task) => task.text);
    record('磁盘上还是 9 条任务（拖拽没有丢东西）', texts.length === 9, `${texts.length} 条`);

    const expectedHead = ['每月八月初八乐乐生日提醒', '今天20号了，花呗准时还款提醒', '今天下午一点半开会'];
    record('磁盘上的顺序就是拖拽之后的顺序',
      expectedHead.every((text, index) => texts[index] === text),
      texts.slice(0, 4).join(' | '));

    record('被拖走的那条不再排在第一', texts[0] !== '今天下午一点半开会', texts[0]);

    return results;
  }
};
