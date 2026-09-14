const fs = require('node:fs');
const path = require('node:path');
const { buildDemoState, localDate } = require('../../tools/capture-window');

/**
 * 跨日归档。验收清单第 4 节原本要求「把系统日期改到明天」——那既麻烦又影响整机。
 *
 * 换成给一份 activeDay 日期是**昨天**的存档：启动时 ensureCurrentDay 会看到
 * 当前本地日期已经前进，于是走完全一样的归档分支。测的是同一个代码路径，
 * 而且完全确定性，不依赖机器时钟。
 */
module.exports = {
  fixture() {
    const state = buildDemoState();
    return {
      ...state,
      activeDay: { date: localDate(-1), closedAt: null, tasks: state.activeDay.tasks },
      history: []
    };
  },

  verify(userData) {
    const results = [];
    const record = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: passed ? null : detail });

    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
    } catch (error) {
      record('归档之后磁盘上的状态仍然可读', false, error.message);
      return results;
    }

    const today = localDate(0);
    const yesterday = localDate(-1);
    const archived = saved.history?.[0];

    record('磁盘上的当天日期已经推进到今天', saved.activeDay.date === today, saved.activeDay.date);
    record('今天的清单是空的', saved.activeDay.tasks.length === 0, `${saved.activeDay.tasks.length} 条`);
    record('昨天整天进了历史', saved.history.length === 1 && archived?.date === yesterday,
      JSON.stringify((saved.history ?? []).map((day) => day.date)));
    record('历史记录带上了归档时间', typeof archived?.closedAt === 'string', archived?.closedAt);
    record('归档保留了原来那 9 条', archived?.tasks?.length === 9, `${archived?.tasks?.length} 条`);
    record('归档里包含未完成项（说明它们没有被搬到今天）',
      Boolean(archived?.tasks?.some((task) => !task.completed)));
    record('归档里的任务仍然带完整字段',
      Boolean(archived?.tasks?.every((task) => typeof task.id === 'string' && typeof task.text === 'string')));
    return results;
  }
};
