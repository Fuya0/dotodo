# 练习 05：手写交互状态机

## 目标

第 5 课把界面从“只读展示”推进到“有状态的交互”：历史页、撤销条、拖拽排序、设置面板。这一课最容易出错的地方不是画界面，而是状态——拖到一半松手、拖到列表外面、撤销刚好过期一秒。

生产代码把这些判断散落在 `src/renderer/app.js` 里，因为那里必须碰真实的 DOM 和指针事件。你要写的是一组不碰 DOM 的等价判断，把它们收敛成纯函数。

## 使用方法

打开 `starter.js`，把 5 个占位函数实现完，然后在 PowerShell 运行：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/05-interactions/starter.test.js
```

单题调试可使用名称过滤，例如：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node --test --test-name-pattern='dropInstruction' exercises/05-interactions/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。不要修改 `starter.test.js` 来迁就实现，也不要修改输入数组或状态对象。

## 题目

### 1. `moveItem(items, from, to)`

输入是任意元素组成的数组和两个下标，返回一个新数组。函数返回值类型始终是 `Array`。

- `items` 不能被修改；返回值不能与输入数组共享同一个数组引用。
- `from`、`to` 必须是 `Number.isInteger(...)` 为真的整数，并且都在 `[0, items.length - 1]` 内。任一不合法时，按原顺序返回 `items` 的副本。
- `from === to` 时内容不变，但仍返回副本。
- 合法移动时，取出 `from` 位置的元素，再插入 `to` 位置；其他元素保持相对顺序。

示例：

```js
moveItem(['a', 'b', 'c'], 0, 2) // ['b', 'c', 'a']
moveItem(['a', 'b', 'c'], 2, 0) // ['c', 'a', 'b']
moveItem(['a', 'b', 'c'], 1, 1) // ['a', 'b', 'c']，但必须是新数组
moveItem(['a', 'b', 'c'], 0, 9) // ['a', 'b', 'c'] 的新副本
moveItem([], 0, 0)             // []
```

提示：先复制，再做 `splice`；用 `Number.isInteger` 验证，不能让 `1.5`、字符串 `'1'` 或负数通过。

### 2. `dropInstruction(rows, clientY, fromIndex)`

`rows` 是除被拖行之外的每一行纵向范围数组，按屏幕从上到下排列；每项至少有数字 `top`、`bottom`。`fromIndex` 是被拖行在完整列表里的原始下标，不能直接当作 `rows` 下标。返回一个新对象：

```js
{ targetIndex, lineIndex, lineSide }
```

字段含义和精确规则：

- `targetIndex` 是移除被拖行之后的列表下标，供生产 `reorderTask(id, targetIndex)` 使用。
- `lineIndex` 是落点线对应的 `rows` 下标；`lineSide` 只能是 `'before'`、`'after'` 或无落点时的 `null`。
- `rows` 为空，或 `clientY` 不是有限数字（如 `NaN`、`Infinity`、字符串）时，返回 `{ targetIndex: -1, lineIndex: -1, lineSide: null }`。
- 若指针落在某行范围内（包含 `top` 与 `bottom`），先判断方向：被拖行原位置在目标行之上时算向下拖，插到目标行之后；被拖行原位置在目标行之下时算向上拖，插到目标行之前。
- 向下拖时 `targetIndex = hoveredRowIndex + 1`，`lineSide = 'after'`；向上拖时 `targetIndex = hoveredRowIndex`，`lineSide = 'before'`。
- 指针在第一行上方时返回最前位置 `targetIndex: 0`、第一行的 `'before'`；在最后一行下方时返回末尾 `targetIndex: rows.length`、最后一行的 `'after'`。
- 返回的 `lineIndex` 始终是 `rows` 中的下标，不是完整列表下标。

示例：

```js
const rows = [
  { top: 0, bottom: 20 },
  { top: 20, bottom: 40 },
  { top: 40, bottom: 60 }
];

dropInstruction(rows, 30, 0)
// { targetIndex: 2, lineIndex: 1, lineSide: 'after' }
// 原第 1 行被拖到原第 3 行所在区域，放到它后面。

dropInstruction(rows, 10, 2)
// { targetIndex: 0, lineIndex: 0, lineSide: 'before' }

dropInstruction(rows, 100, 0)
// { targetIndex: 3, lineIndex: 2, lineSide: 'after' }

dropInstruction([], 10, 0)
// { targetIndex: -1, lineIndex: -1, lineSide: null }
```

提示：先找出 `rows` 中命中的行；命中后再用 `fromIndex` 与命中行在完整列表中的位置比较。`rows` 中位于原始 `fromIndex` 之后的行，在完整列表中多偏移一位。

**最容易写错的一处：指针停在"拿走之后下标恰好等于 `fromIndex`"的那一行上。**
这时朴素的"直接比较 `fromIndex` 和命中行下标"会判成向上拖，正确结果应该是向下拖。

```js
// 拖的是完整列表里的第 2 行（fromIndex = 1），指针停在 rows[1] 里
dropInstruction(rows, 30, 1)
// 正确：{ targetIndex: 2, lineIndex: 1, lineSide: 'after' }
// 错误实现会给 { targetIndex: 1, lineIndex: 1, lineSide: 'before' }
```

原因是 `rows` 里没有自己：`rows[1]` 在完整列表里其实是第 3 行（下标 2），
所以"拖的第 2 行插到第 3 行之后"，方向是向下。

### 3. `undoWindow(issuedAt, now)`

输入是两个时间戳，单位都是毫秒，返回新对象：

```js
{ remainingMs, expired }
```

撤销窗口总长固定为 `6000` 毫秒。

- `remainingMs` 是 `number`，范围为 `0` 到 `6000`，不能为负，也不能超过总时长。
- `now - issuedAt` 小于等于 `6000` 时仍有效；正好差 `6000` 的边界 `expired` 必须是 `false`，差 `6001` 才是 `true`。
- 时钟回拨（`now < issuedAt`）按窗口刚开始处理，剩余 `6000`，不能多于总时长。

示例：

```js
undoWindow(0, 0)    // { remainingMs: 6000, expired: false }
undoWindow(0, 5999) // { remainingMs: 1, expired: false }
undoWindow(0, 6000) // { remainingMs: 0, expired: false }
undoWindow(0, 6001) // { remainingMs: 0, expired: true }
undoWindow(1000, 2500) // { remainingMs: 4500, expired: false }
```

提示：先把经过时间限制在 `[0, 6000]`，再用“经过时间大于 6000”判断过期；不要用剩余时间等于 0 判断过期，因为正好到期仍可撤销。

### 4. `summarizeHistory(days)`

输入是日期数组，每项形如 `{ date, tasks }`，其中 `tasks` 是任务数组，每项从 `completed` 读取真假值。返回：

```js
{ dayCount, taskCount, completedCount, completionRate, bestDay }
```

- `dayCount` 是 `days.length`；`taskCount` 是所有日期任务数总和；`completedCount` 是 `completed` 真值任务总数。
- `completionRate` 是 `completedCount / taskCount`；没有任务时必须是数字 `0`，不能是 `NaN`。
- `bestDay` 是完成数最多那一天的 `date` 字段；如果并列，保留先出现的日期；如果所有日期都没有完成项，返回 `null`。
- 一次遍历完成统计。输入顺序就是并列时的优先顺序；不要排序或修改 `days`、`tasks`。

示例：

```js
summarizeHistory([
  { date: '2026-09-12', tasks: [{ completed: true }, { completed: false }] },
  { date: '2026-09-11', tasks: [{ completed: 1 }] }
])
// { dayCount: 2, taskCount: 3, completedCount: 2,
//   completionRate: 2 / 3, bestDay: '2026-09-12' }

summarizeHistory([])
// { dayCount: 0, taskCount: 0, completedCount: 0,
//   completionRate: 0, bestDay: null }
```

提示：为每一天维护一个局部完成数，只在它严格大于当前最大值时更新 `bestDay`；使用 `>` 而不是 `>=` 保留先出现者。

### 5. `reduceDrag(state, event)`

这是一个纯状态机：输入和返回值都是普通对象，不能修改传入的 `state` 或 `event`。状态只有两种形状：

```js
{ status: 'idle' }
{ status: 'dragging', id, fromIndex, targetIndex }
```

事件只有四种形状：`{ type: 'start', id, index }`、`{ type: 'move', targetIndex }`、`{ type: 'finish' }`、`{ type: 'cancel' }`。返回：

```js
{ state, command }
```

规则如下：

| 当前状态与事件 | 返回的 `state` | 返回的 `command` |
| --- | --- | --- |
| `idle` + `start`，`index >= 0` | 新的 dragging，`fromIndex` 和初始 `targetIndex` 都等于 `index` | `null` |
| `idle` + `start`，`index < 0` | `{ status: 'idle' }` | `null` |
| `dragging` + `start` | 原状态内容 | `null` |
| `dragging` + `move`，`targetIndex` 是整数 | 更新 targetIndex 的 dragging 状态 | `null` |
| `dragging` + `move`，targetIndex 不是整数 | 原状态内容 | `null` |
| `dragging` + `finish`，targetIndex 与 fromIndex 不同 | `{ status: 'idle' }` | `{ type: 'reorder', id, targetIndex }` |
| `dragging` + `finish`，位置没变 | `{ status: 'idle' }` | `null` |
| 任意状态 + `cancel` | `{ status: 'idle' }`，只能有 `status` 键 | `null` |
| `idle` + `move` 或 `finish` | `{ status: 'idle' }` | `null` |

示例：

```js
reduceDrag({ status: 'idle' }, { type: 'start', id: 'a', index: 1 })
// { state: { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 }, command: null }

reduceDrag(
  { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 1 },
  { type: 'move', targetIndex: 3 }
)
// { state: { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 3 }, command: null }

reduceDrag(
  { status: 'dragging', id: 'a', fromIndex: 1, targetIndex: 3 },
  { type: 'finish' }
)
// { state: { status: 'idle' }, command: { type: 'reorder', id: 'a', targetIndex: 3 } }
```

提示：先按 `event.type` 分支，再区分 idle/dragging；结束或取消时显式构造只有 `status` 的 idle 对象，避免把拖拽字段泄漏到下一轮。

## 代码阅读题

生产引用已核对：拖拽排序、撤销条、`reorderTask` 和设置状态都在 `src/renderer/app.js`，领域层的六秒令牌在 `src/domain/daily-todo-engine.js`。

打开 `src/renderer/app.js` 和 `src/domain/daily-todo-engine.js`，回答：

1. `beginDrag` 为什么把 `pointermove`、`pointerup`、`pointercancel` 和 `blur` 监听到 `window` 上，而不是只监听拖拽手柄？如果快速拖出手柄，为什么只监听手柄会丢事件？
2. `onDragMove` 为什么先把被拖行从行列表里排除，再算落点？如果不排除，`fromIndex` 和 `rows` 的下标还对得上吗？
3. `cleanupDrag` 里移除的五个监听器为什么要和添加时一一对应？漏掉 `pointerleave` 会有什么后果？
4. `showUndoBar` 里 `dom.undoProgress.style.animation = 'none'; void dom.undoProgress.offsetWidth;` 这两行在做什么？只写第一行或只写第二行会怎样？
5. 撤销条把可见性留给渲染进程，把令牌有效性留给主进程的 `expiresAt`。如果反过来让渲染进程决定令牌是否有效，会有什么风险？

## 本题不要求处理的情况

- 相邻两行共享边界（`rows[i].bottom === rows[i+1].top`）时指针恰好落在边界上取哪一行
- `rows` 之间有空隙、指针落在空隙里
- `fromIndex` 是非整数或越界
- `undoWindow` 的时间戳是 `NaN` / 非数字
- `summarizeHistory` 的 `days` 不是数组、`day.tasks` 或 `day.date` 缺失
- `reduceDrag` 收到未知的 `event.type` 或未知的 `state.status`；`start` 的 `index` 给小数

## 复盘问题

1. “乐观更新”和“悲观更新”各适合什么场景？DoTodo 为什么选悲观？
2. 为什么 `showUndoBar` 每次都要重新触发 CSS 动画，而不是给元素加个 `is-visible` 类就完事？
3. 历史任务被延续到 Today 之后，为什么删除目标任务不会重新打开“延续”按钮？
4. 为什么 `reorderTask` 的目标下标是“移除被拖行之后”的位置？直接使用视觉位置会差多少？
5. 拖拽排序对键盘用户不可用，因此项目额外提供了 `Alt + ↑/↓`。如果只做拖拽，键盘用户会失去什么操作路径？
