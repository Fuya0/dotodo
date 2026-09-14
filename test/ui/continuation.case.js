const fs = require('node:fs');
const path = require('node:path');
const { localDate } = require('../../tools/capture-window');

/**
 * 从历史延续到今天。用默认演示存档就够了：它的历史里正好有一条未完成任务
 * （`给客户回邮件`）和两条已完成任务，可以同时验证「能延续」和「不该能延续」。
 *
 * **注意这里检查的是场景跑完之后的最终状态。** 场景最后一步会把延续出来的任务删掉，
 * 所以磁盘上应该看到：来源任务仍然带着 `hasBeenContinued: true`，但反向链接已经清空。
 *
 * 「延续的瞬间两边互相指向」这条由 test/domain/daily-todo-engine.test.js 用单元测试覆盖
 * （那里可以逐步检查中间状态）；这里守的是它之后的那条产品承诺：
 * **删掉目标不会让延续按钮重新开放。**
 */
module.exports = {
  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    } catch (error) {
      record('延续之后磁盘上的状态仍然可读', false, error.message);
      return results;
    }

    const yesterday = localDate(-1);
    const archived = saved.history?.find((day) => day.date === yesterday);
    const source = archived?.tasks?.find((task) => task.text === '给客户回邮件');
    const stillThere = saved.activeDay?.tasks?.some((task) => task.text === '给客户回邮件');

    record('来源历史日还在', Boolean(archived), JSON.stringify(saved.history?.map((d) => d.date)));
    record('来源任务还在', Boolean(source));
    record('延续出来的任务已经被删掉（场景最后一步）', !stillThere,
      JSON.stringify(saved.activeDay?.tasks?.map((t) => t.text)));
    record('删掉目标之后来源仍标记为「已延续过」', source?.hasBeenContinued === true,
      String(source?.hasBeenContinued));
    record('删掉目标之后反向链接被清空',
      source?.continuedToTaskId === null && source?.continuedToDate === null,
      `${source?.continuedToTaskId} / ${source?.continuedToDate}`);
    record('来源任务本身没有被改写', source?.text === '给客户回邮件' && source?.completed === false);
    record('今天没有多出别的任务', saved.activeDay?.tasks?.length === 9,
      `${saved.activeDay?.tasks?.length} 条`);
    record('来源任务没有把「延续过」这件事丢掉', source?.hasBeenContinued === true);

    return results;
  }
};
