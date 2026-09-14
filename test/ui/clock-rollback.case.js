const fs = require('node:fs');
const path = require('node:path');
const { buildDemoState, localDate } = require('../../tools/capture-window');

/**
 * 系统日期被调回过去。
 *
 * 验收清单第 4.5 节。产品规则是：**绝不因为时钟回拨就把已经归档的日期重新打开**，
 * 否则用户会看到"昨天的清单又变回今天的了"，而任何按它做的操作都会污染历史。
 *
 * 起始存档的 activeDay 是**明天**，启动时本地日期比它早，于是走回退保护分支。
 * 同样不需要改系统时间。
 */
module.exports = {
  fixture() {
    const state = buildDemoState();
    return {
      ...state,
      activeDay: { date: localDate(1), closedAt: null, tasks: state.activeDay.tasks },
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
      record('回拨之后状态文件仍然可读', false, error.message);
      return results;
    }

    record('清单日期没有被回退', saved.activeDay?.date === localDate(1), saved.activeDay?.date);
    record('没有因为回拨而凭空产生历史', saved.history?.length === 0, `${saved.history?.length} 天`);
    // 场景最后一步在回拨状态下加了一条任务（证明应用仍然可用），所以这里是 10 而不是 9。
    record('原有 9 条任务一条没少',
      saved.activeDay?.tasks?.filter((task) => task.text !== '回拨期间也能添加').length === 9,
      `${saved.activeDay?.tasks?.length} 条`);
    record('回拨状态下新增的任务被正常保存',
      saved.activeDay?.tasks?.some((task) => task.text === '回拨期间也能添加'),
      JSON.stringify(saved.activeDay?.tasks?.map((t) => t.text)));

    return results;
  }
};
