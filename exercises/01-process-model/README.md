# 练习 01：参数、返回值、数组与闭包

本组有 5 道题。你已经完成的代码请保留；这次只补齐题意，不需要因为说明变长而重写答案。

## 打开哪个文件、怎么做

1. 打开本目录的 `starter.js`，找到当前题同名的函数。
2. 保留函数名、参数和底部 `module.exports`。删掉函数里的占位 `throw new Error('请实现…')`，换成你的逻辑。需要结果的地方写 `return`，不是只写 `console.log`。
3. 一次只做一题，保存后再运行。

在 PowerShell 中执行（第一行进入学习目录，不是软件目录）：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/01-process-model/starter.test.js
```

只检查第 1 题可以执行：

```powershell
node --test --test-name-pattern='^clamp ' exercises/01-process-model/starter.test.js
```

`starter.test.js` 是判分标准，不用修改。后面没做的题报“请实现…”是正常的。测试通过说明列出的用例通过，不代表覆盖了所有可能输入。

## 题目

### 1. `clamp(value, minimum, maximum)`

**做什么：** 把数值限制在包含两端的区间内。

**输入：** 三个有限数字，并保证 `minimum <= maximum`。本题不要求处理字符串、NaN 或上下限颠倒。

**返回：** 一个数字。小于下限返回下限，大于上限返回上限，处于区间内保持原值。

```js
clamp(40, 55, 100)  // 55
clamp(72, 55, 100)  // 72
clamp(120, 55, 100) // 100
clamp(55, 55, 100)  // 55，两端也在区间内
```

**提示：** 可以用 `if`，也可以组合 `Math.min` 和 `Math.max`。题目不限制写法。

### 2. `normalizeTaskText(value)`

**输入：** 任意 JavaScript 值。

**步骤和返回：**

| 情况 | 返回值 |
| --- | --- |
| 不是字符串 | `{ ok: false }` |
| 去掉首尾空白后为空 | `{ ok: false }` |
| 去掉首尾空白后 `.length > 20` | `{ ok: false }` |
| 其余字符串 | `{ ok: true, text: 去掉首尾空白后的字符串 }` |

20 按 JavaScript 的字符串 `.length` 计数，不是按屏幕显示宽度；正好 20 合法。保留文字中间的空格。失败结果不需要 `text` 或 `error` 字段，也不要抛异常。

```js
normalizeTaskText('  学 Electron  ') // { ok: true, text: '学 Electron' }
normalizeTaskText('   ')            // { ok: false }
normalizeTaskText(42)               // { ok: false }，不要把数字转成字符串
```

**提示：** 先用 `typeof` 检查，再调用 `.trim()`；否则数字没有 `.trim()` 方法。

### 3. `moveItem(items, fromIndex, toIndex)`

**输入：** 一个数组，两个整数下标。下标从 0 开始。本题基础范围不要求处理小数下标或非数组。

**返回：** 一个新数组。把 `fromIndex` 的元素拿走，再插到新数组的 `toIndex` 位置；不是交换两个元素。

- 不允许修改传入的数组。
- 下标小于 0 或大于等于数组长度时，返回原内容的副本，不能直接返回原数组引用。
- 起点和终点相同，仍返回副本。
- 只要求浅复制，不要求复制数组里的对象。

```js
moveItem(['A', 'B', 'C'], 0, 2)  // ['B', 'C', 'A']
moveItem(['A', 'B', 'C'], 2, 0)  // ['C', 'A', 'B']
moveItem(['A', 'B', 'C'], -1, 2) // ['A', 'B', 'C']，但引用不同
```

**提示：** `.slice()` 可以复制；`.splice()` 会修改调用它的数组，所以应当对副本使用。数组要返回 `[...]` 形状，不能用对象展开写成 `{...items}`。

### 4. `createSequence(values)`

**输入：** 一个数组。

**返回：** 一个函数。注意：这里第一次返回的不是数组中的元素，是一个之后可以反复调用的函数。

```js
const next = createSequence(['first', 'second']);
next(); // 'first'
next(); // 'second'
next(); // 抛出 Error，消息必须包含“用完”或“耗尽”
```

- 每次调用取下一个值；不同的 `createSequence` 调用应各自拥有独立进度。
- 输入空数组时，第一次调用返回的函数就抛错。
- 当前题目没有限制是否修改 `values`，用索引保存进度或对数组取值都可通过现有判分；“不改变原数组”可以作为拓展，不能当作隐藏要求。

**提示：** 外层函数先运行一次，内层函数以后运行多次；内层仍能访问外层变量，这就是闭包。本题用完时确实需要 `throw`，不要把所有题里的 `throw` 都理解成绝对不能出现。

### 5. `rollover(state, nextDate)`

这是简化的跨日练习，不用照搬软件完整存档。输入保证日期是可比较的 `YYYY-MM-DD` 格式：

```js
const state = {
  activeDay: { date: '2026-09-13', tasks: [{ id: '1' }] },
  history: [{ date: '2026-09-12', tasks: [] }]
};
```

| `nextDate` 与当前日期的关系 | 做什么 |
| --- | --- |
| 相同 | 返回相同内容的状态副本 |
| 晚于当前日期 | 把旧 `activeDay` 放到 `history` 最前；新 `activeDay` 为 `{ date: nextDate, tasks: [] }` |
| 早于当前日期 | 抛出 `Error`，消息必须包含“回退” |

例如 `rollover(state, '2026-09-14')` 应返回：

```js
{
  activeDay: { date: '2026-09-14', tasks: [] },
  history: [
    { date: '2026-09-13', tasks: [{ id: '1' }] },
    { date: '2026-09-12', tasks: [] }
  ]
}
```

不修改输入的 `state`、原历史数组或任务内容。这里只归档已有的当天；即使跨过多天，也不补造空白日期。浅复制足够，不要求深复制每条任务。

**提示：** 先把三个日期分支写出来，再分别决定返回内容。新的一天不会自动带入昨天的任务。

## 做完再回答（不参与自动判分）

1. 为什么第 3 题不能在原数组上直接调用 `splice`？
2. `return` 和 `console.log` 有什么不同？
3. 第 4 题的进度为什么不会每次都从头开始？
4. 展开对象与展开数组，返回值的类型有什么不同？
5. 测试全绿是否意味着已经检查了所有边界？举一个本组没有覆盖的例子。

## 本题不要求处理的情况

判分测试只检查上面写明的行为。下面这些**没有测试覆盖**，你不需要为它们设计规则，也不需要猜：

- `rollover` 同日分支：`state` 上除 `activeDay` / `history` 之外的额外顶层字段（保留或丢弃都不判分）
- `rollover` 同日分支：`activeDay.tasks` 是否与输入共享引用（浅复制即可）
- `clamp` 的 `minimum > maximum`、`normalizeTaskText` 的代理对字符长度
- `moveItem` 的小数下标、非数组输入
