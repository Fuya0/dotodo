# 练习 05：手写交互状态机

## 目标

第 5 课把界面从「只读展示」推进到「有状态的交互」：历史页、撤销条、拖拽排序、设置面板。这一课最容易出错的地方不是画界面，而是**状态**——拖到一半松手、拖到列表外面、撤销刚好过期一秒。

生产代码把这些判断散落在 `src/renderer/app.js` 里，因为那里必须碰真实的 DOM 和指针事件。你要写的是一组**不碰 DOM** 的等价判断，把它们收敛成纯函数。

## 使用方法

打开 `starter.js`，把 5 个占位函数实现完，然后运行：

```powershell
node exercises/electron/05-interactions/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。

## 题目

### 1. `moveItem(items, from, to)`

把 `from` 位置的元素移动到 `to` 位置，返回**新数组**。

- 传入数组不能被修改；
- `from`、`to` 必须是 `[0, items.length - 1]` 内的整数（用 `Number.isInteger`），否则原样返回一份副本；
- `from === to` 时结果与原数组内容相同，但仍是新数组。

先想办法验证「返回的是新数组」：`assert.notEqual(result, source)` 比较的是引用。

### 2. `dropInstruction(rows, clientY, fromIndex)`

`rows` 是**除被拖行之外**每一行的纵向范围（`{ top, bottom }`，按屏幕从上到下）。
`fromIndex` 是被拖行在**完整列表**里的原始下标 —— 注意它和 `rows` 的下标不是一回事。

规则：**指针落在哪一行里，就插到那一行的后面或前面 —— 取决于你往下拖还是往上拖。**

- 往下拖（被拖行的原位置在目标行之上）→ 插到目标行**之后**；
- 往上拖（被拖行的原位置在目标行之下）→ 插到目标行**之前**；
- 指针在所有行上方 → 插到最前；在所有行下方 → 插到最后（末尾是 `rows.length`，不是 `length - 1`）；
- `rows` 为空、或 `clientY` 不是有限数 → `{ targetIndex: -1, lineIndex: -1, lineSide: null }`。

返回：

```js
{ targetIndex, lineIndex, lineSide }
```

- `targetIndex` 是「**移除被拖行之后**」的列表下标，正好是 `reorderTask` 需要的位置；
- `lineIndex` / `lineSide`（`'before'` / `'after'`）说明落点线该画在哪一行的上边还是下边。

> **为什么不用"越过中线才算插到后面"那套。** 那套规则下想跟第 3 行换位，指针必须落到第 3 行的
> **下半部分**；停在上半部分就变成"插到第 3 行之前"，看起来成了跟第 2 行换位。一次真机验收
> 报的就是这个（原话："我 1 和 3 换位，结果是 1 和 2 换位"）。
>
> 真正的难点是 `rows` 的下标和完整列表的下标对不上：`rows` 里排在 `fromIndex` 之后的每一行，
> 在完整列表里都要往后错一位。这一步想清楚了，整个函数就只剩几行。

### 3. `undoWindow(issuedAt, now)`

撤销窗口是六秒。返回：

```js
{ remainingMs, expired }
```

- 剩余时间不能是负数，也不能超过 6000；
- **边界**：正好差 6000ms 仍然有效（`expired: false`），差 6001ms 才过期；
- 时钟回拨（`now < issuedAt`）时剩余时间是 6000，不是更大的数。

### 4. `summarizeHistory(days)`

`days` 形如 `[{ date, tasks: [{ completed }] }]`。返回：

```js
{ dayCount, taskCount, completedCount, completionRate, bestDay }
```

- `completionRate` 是 `completedCount / taskCount`，没有任务时是 `0`；
- `bestDay` 是完成数最多的那一天的 `date`；数量相同时保留**先出现**的那一天；没有任何完成项时为 `null`。

一次性遍历完成，不要为了三四个统计值扫四遍数组。

### 5. `reduceDrag(state, event)`

手写一个小型状态机。`state` 只有两种形状：

```js
{ status: 'idle' }
{ status: 'dragging', id, fromIndex, targetIndex }
```

`event` 有四种：`{ type: 'start', id, index }`、`{ type: 'move', targetIndex }`、`{ type: 'finish' }`、`{ type: 'cancel' }`。

返回 `{ state, command }`：

| 情形 | 结果 |
| --- | --- |
| `idle` + `start`，`index >= 0` | 进入 `dragging`，`targetIndex` 等于 `fromIndex`，`command` 为 `null` |
| `idle` + `start`，`index < 0` | 保持 `{ status: 'idle' }` |
| `dragging` + `start` | 状态原样返回，不重新开始 |
| `dragging` + `move`，`targetIndex` 是整数 | 更新 `targetIndex` |
| `dragging` + `move`，`targetIndex` 不是整数 | 状态原样返回 |
| `dragging` + `finish`，位置变了 | `{ status: 'idle' }` 并发出 `{ type: 'reorder', id, targetIndex }` |
| `dragging` + `finish`，位置没变 | `{ status: 'idle' }`，`command` 为 `null` |
| 任何状态 + `cancel` | `{ status: 'idle' }`，**永不**发出命令 |
| `idle` + `move` / `finish` | 保持 `{ status: 'idle' }` |

注意最后一条：结束拖拽后的 `state` 必须**只有** `status` 一个字段，不能把 `id` 留在里面。

## 代码阅读题

打开 `src/renderer/app.js`，回答：

1. `beginDrag` 为什么把 `pointermove` / `pointerup` 监听到 `window` 上，而不是拖拽手柄上？如果只监听手柄，快速拖动时会丢事件吗？
2. `onDragMove` 为什么先把被拖行从行列表里排除，再算落点？如果不排除，`fromIndex` 和 `rows` 的下标还对得上吗？
3. `cleanupDrag` 里五个 `removeEventListener` 是必需的还是可以省略？漏掉 `pointerleave` 那个会有什么后果？
4. `showUndoBar` 里 `dom.undoProgress.style.animation = 'none'; void dom.undoProgress.offsetWidth;` 这两行在做什么？只写第一行或只写第二行会怎样？
5. 撤销条把「可见性」留给渲染进程，「有效性」留给主进程的 `expiresAt`。如果反过来，让渲染进程决定令牌是否有效，会有什么风险？

## 复盘问题

1. 「乐观更新」和「悲观更新」各适合什么场景？DoTodo 为什么选悲观？
2. 为什么 `showUndoBar` 每次都要重新触发 CSS 动画，而不是给元素加个 `is-visible` 类就完事？
3. 历史任务被延续到 Today 之后，为什么删除目标任务不会重新打开「延续」按钮？
4. 为什么 `reorderTask` 的目标下标是「移除被拖行之后」的位置？直接用视觉位置会差多少？
5. 拖拽排序对键盘用户不可用，因此项目额外提供了 `Alt + ↑/↓`。如果只做拖拽，损失的是什么？
