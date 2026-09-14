# 第 5 课：状态驱动的交互——历史、撤销、拖拽与设置

## 本课完成了什么

第 4 课把 Today 画出来了，但界面还是「一次性」的：历史标签点不动，删除没有后悔药，任务顺序定死，设置面板只有一个滑块。这一课补上四块交互，并且**每一块都由状态决定，而不是由临时的 DOM 状态决定**。

| 功能 | 状态来源 | 渲染进程新增的职责 |
| --- | --- | --- |
| 历史页 | `snapshot.history` | 投影成只读列表，只有删除和延续两个动作 |
| 六秒撤销 | 领域引擎的 `undoRecord` + 快照里的 `undoToken` | 计时器只控制可见性 |
| 拖拽排序 | 本地的拖拽状态机 | 指针事件、落点计算、发出 `reorderTask` |
| 设置面板 | `snapshot.settings` | 滑块、模式切换、面板开合 |

对应文件：

| 文件 | 改动 |
| --- | --- |
| `src/renderer/view-model.js` | 新增 `deriveHistoryView`、`deriveSettingsView`、`resolveDropIndex` |
| `test/renderer/view-model.test.js` | 新增 14 个投影测试 |
| `test/renderer/markup.test.js` | 新增 6 条静态约束 |
| `src/renderer/index.html` | 历史页、设置面板头部、撤销条倒计时条 |
| `src/renderer/app.js` | 页面切换、历史渲染、拖拽状态机、模式切换 |
| `src/renderer/styles.css` | 历史列表、拖拽手柄、分段控件、倒计时动画 |

## 派生状态：不要在界面里存第二份真相

这一课最重要的一条规矩：**界面不保存任何可以从快照算出来的东西。**

反例：

```js
let completedCount = 0;               // 快照里已经能算出来
function toggle(id) {
  completedCount += 1;                // 一旦命令失败，这个数就和快照不一致了
}
```

DoTodo 的做法是每次渲染都从快照重新投影：

```js
function render() {
  const settings = deriveSettingsView(state.snapshot);
  renderToday(deriveTodayView(state.snapshot));
  renderHistory(deriveHistoryView(state.snapshot));
  renderPage();
}
```

渲染进程里只有四样真正的本地状态：当前页面、正在编辑的任务 ID、待撤销令牌、拖拽状态。除此之外，屏幕上的一切都是快照的函数：

```text
界面 = f(快照)
```

这样做的代价是每次命令后要重画整个列表。对一个几百条任务的小工具，这个代价可以忽略；换来的是「界面永远不可能和真实数据不一致」。等到列表真的很大时，正确的优化是**增量更新**，而不是引入第二份真相。

### 历史页的投影

```js
function deriveHistoryView(snapshot) {
  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  const days = [...history].sort(compareDaysDescending).map(toHistoryDay);
  ...
}
```

注意 `[...history]` 这个复制。`Array.prototype.sort` **就地排序**，如果直接写 `history.sort(...)`，就等于在渲染时默默改动了传入的快照。快照本来应该是只读的，这个 bug 不会立刻报错，只会让某一天的数据顺序莫名其妙地变掉。测试里专门有一条：投影之后把返回的 `days` 反转，快照必须纹丝不动。

延续按钮的可见性完全由数据决定：

```js
const continuedOnward = Boolean(task.hasBeenContinued) || Boolean(task.continuedToTaskId);
const canContinue = !completed && !continuedOnward;
```

三种情况都不能再延续：已经完成的、已经延续过的、当前正链接着一个后续任务的。这里的关键是「历史事实」和「当前链接」分开存：删除 Today 里那个延续出来的任务时，领域引擎会清掉 `continuedToTaskId` 双向链接，但**保留** `hasBeenContinued = true`。于是按钮不会重新出现——历史任务终身最多延续一次。

## 指针事件与拖拽状态机

HTML5 的 `dragstart` / `drop` 不适合这个场景：它携带的是文件或文本，需要 `dataTransfer`，在无边框透明窗口里还会带出系统拖拽图像。DoTodo 用的是 Pointer Events，也就是 `pointerdown` / `pointermove` / `pointerup`。

拖拽本质上是一个小状态机：

```text
idle ──start(有下标)──▶ dragging ──finish(位置变了)──▶ idle + reorderTask
  │                        │
  └──start(无下标)──▶ idle  └──finish(位置没变)/cancel──▶ idle
```

用纯函数表达就是 `reduceDrag(state, event) → { state, command }`。这正是练习 05 的第 6 题：把「下一步是什么状态、要不要发命令」和「怎么读写 DOM」分开，前者就可以在 Node 里穷举测试。

真实代码里对应的是这几个函数：

```js
function beginDrag(event, id) {
  if (event.button !== 0 || state.drop) return;      // 只认左键，且不能重复开始
  const row = findRow(id);
  if (!row) return;
  event.preventDefault();                            // 阻止文字选中和原生拖拽
  state.drop = { id, row, fromIndex, targetIndex: fromIndex, pointerId: event.pointerId };
  row.classList.add('dragging');
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', cancelDrag);
  dom.list.addEventListener('pointerleave', cancelDrag);
}
```

监听器挂在 `window` 上而不是手柄上，因为拖得快时指针会离开手柄甚至离开列表；只挂在手柄上就会丢事件，表现为「拖着拖着手就松了」。反过来，`pointerleave` 挂在列表上，用户把行拖出列表就取消——这也是产品上更符合直觉的行为。

`pointerId` 是必须校验的：触摸屏上可以同时有多个手指，不校验就会把两根手指的移动混成一次拖拽。

### 落点为什么是「移除之后」的下标

`reorderTask(id, targetIndex)` 在领域层的实现是：

```js
const [task] = tasks.splice(currentIndex, 1);   // 先拿走
tasks.splice(targetIndex, 0, task);             // 再插入
```

所以 `targetIndex` 是「拿走被拖行**之后**」的数组下标。而视觉上量出来的中点却来自「还没拿走」的数组。两者在向下拖时正好差一位。

处理办法不是去补正 1，而是让计算和语义保持一致：

```js
const others = rowsOf().filter((row) => row !== drop.row);   // 先排除自己
const midpoints = others.map((row) => row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
const targetIndex = resolveDropIndex(midpoints, event.clientY);
```

候选里没有自己，量出来的下标天然就是「移除之后」的位置，直接可以递给 `reorderTask`。这也是为什么 `resolveDropIndex` 值得单独抽成纯函数——它只做一件事：一串中点加一个纵坐标，推出落点。

### 拖拽不是唯一的排序方式

拖拽对键盘用户完全不可用。所以列表的键盘处理里还有一条：

```js
if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
  event.preventDefault();
  moveTaskByKeyboard(item, event.key === 'ArrowDown' ? 1 : -1);
}
```

目标下标同样是 `from + delta`：向下移动时，把元素从数组里拿走会让后面的元素前移一位，插到 `from + 1` 正好落在原来下一个元素的后面。

## 计时器与「谁说了算」

撤销条看起来是个纯前端功能，但它有一条重要的边界：**渲染进程只控制看得见看不见，主进程控制还算不算数。**

```js
function showUndoBar(message) {
  dom.undoText.textContent = message;
  dom.undoBar.hidden = false;
  dom.undoProgress.style.animation = 'none';
  void dom.undoProgress.offsetWidth;        // 强制回流，让动画从头播
  dom.undoProgress.style.animation = '';
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(hideUndoBar, UNDO_VISIBLE_MS);
}
```

上面那两行是一个经典技巧。CSS 动画只在元素「第一次」获得这个动画时播放；把 `animation` 设成 `none` 再设回来，浏览器并不会重播，因为它可能在同一个样式重算批次里合并掉。必须在中间**读一次布局属性**（`offsetWidth`）强制回流，让浏览器确认「动画确实被移除了」，才会在恢复时重新开始。`void` 只是表明「这个值我故意不用」，避免 linter 报无用表达式。

那为什么不让渲染进程决定令牌是否有效？因为渲染进程的代码是可以被改坏的（加载了第三方脚本、调试时手动改了几行），而「删除后 6 秒内可以恢复」是产品规则。领域引擎自己记着：

```js
undoRecord = { token, date, index, task, expiresAt: issuedAt + 6000 };
```

边界很明确：正好 6000ms 仍然可撤销，6001ms 立刻失效。就算页面伪造一个过期令牌发过来，主进程也只会返回「撤销时间已结束」。

## 悲观更新：命令返回什么，界面就画什么

所有命令都走同一个包装：

```js
async function runCommand(promise) {
  const result = await promise;
  if (!result || result.cancelled) return null;
  if (result.ok === false) showMessage(result.error);
  if (result.snapshot) applySnapshot(result.snapshot);
  return result;
}
```

这里没有「先改界面、失败了再回滚」。用户点一次勾选，界面要等主进程把新快照发回来才变化。对本地 JSON 写入来说这个延迟通常在几毫秒内，肉眼看不出；换来的是**屏幕上不会出现任何未经确认的状态**。

对比一下「乐观更新」：它假设命令一定成功，立刻改界面，失败时回滚。适合网络请求这种「大概率成功、延迟明显、失败可重试」的场景。DoTodo 面向的是本机唯一一份数据，一次错误的回滚就可能让用户以为已经存好的内容消失，所以选了悲观。

撤销条、错误条、运行期警告都遵循同一条原则：它们是快照和主进程状态的**投影**，不是独立的真相来源。

## 设置面板：原地更新而不是重建

设置面板里的开关如果用「每次渲染都重建元素」的写法会有一个小毛病：重建之后焦点掉回 `body`，
用户接着按空格或方向键就没反应了。所以开关是**原地更新**的——元素只建一次，之后只改属性：

```js
function renderSettings(settings) {
  dom.closeToTrayToggle.checked = settings.closeToTray;
  dom.launchAtLoginToggle.checked = settings.launchAtLogin;
}
```

列表则相反：任务行每次渲染都重建（行数、顺序、内容都可能变），因为那里没有需要保留的交互状态。
**要不要原地更新，取决于这个元素身上有没有"不属于快照的状态"**——焦点、展开/收起、正在输入的文字。
有就原地改，没有就重建。

这一课的设置面板还没有开关项：「关闭到托盘」和「开机启动」要等第 6 课接入原生壳层。界面上不提前摆出点不动的开关。

背景透明度**不在这里**。它是固定的视觉常量（中性灰 88%），因为把它做成滑杆就等于让用户
有机会把文字对比度调到看不清。设计取舍写在第 4 课。

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo
npm start
```

应该能验证：

1. 添加几条任务，用左侧手柄拖动换顺序，松手后顺序保持；
2. 用 `Alt + ↑/↓` 做同样的事，确认纯键盘也能排序；
3. 删除一条任务，底部弹出撤销条，蓝条六秒内从满到空；点「撤销」恢复原位置；
4. 切到「历史」标签，历史日期按倒序排列，行内没有编辑入口；
5. 未完成且从未延续的历史任务显示「延续到今天」，点一下会出现在今天，并且它自己变成「已延续到 …」；
6. 打开设置，确认面板里只有已经接了真实实现的项，没有点不动的开关。

自动化：

```powershell
node test/renderer/view-model.test.js
node test/renderer/markup.test.js
npm run smoke
```

`markup.test.js` 在这一课多了六条约束，其中两条特别值得注意：

```js
assert.match(app, /textContent = row\.text/);
const unsafe = [...app.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)]
  .map((match) => match[1].trim())
  .filter((value) => !['CHECK_ICON', 'DELETE_ICON', 'DRAG_ICON'].includes(value));
assert.deepEqual(unsafe, []);
```

它把「`innerHTML` 只能写图标常量」变成了可执行的规则。这类约束之所以值得写，是因为它们拦住的正是那种「本地跑起来一切正常，上线后被人插了一段 HTML」的问题。

另外两条是结构性的：CSS 大括号必须成对、HTML 常用标签必须开合一致。在不能启动渲染进程的环境里，这是成本最低的「文件被写坏了」探测器。

## 常见错误

- 把 `completedCount` 缓存成模块级变量，命令失败后与快照不一致；
- 直接 `snapshot.history.sort(...)`，渲染时改动了只读数据；
- 用 HTML5 `dragstart`/`drop` 而不是 Pointer Events；
- 只监听手柄上的 `pointermove`，快速拖动丢事件；
- 不校验 `pointerId`，多指触摸时状态错乱；
- 用视觉位置当作 `reorderTask` 的目标下标，向下拖永远差一位；
- 忘记在 `pointercancel` / `blur` / 列表外离开时清理状态，界面卡在 `dragging`；
- 撤销条只加一个 `is-visible` 类，倒计时动画不会重播；
- 让渲染进程判断撤销是否过期，等于把产品规则交给了可被改坏的代码；
- 每次渲染都重建设置按钮，点击后焦点丢失。

## 阅读顺序

1. `test/renderer/view-model.test.js` 里 `deriveHistoryView` 和 `resolveDropIndex` 的断言：先看产品规则；
2. `src/renderer/view-model.js` 的 `deriveHistoryView` / `toHistoryRow` / `historyStatusLabel`；
3. `src/renderer/app.js` 的 `renderHistory` / `createHistoryRow`：只读行长什么样；
4. `src/renderer/app.js` 的 `beginDrag` / `onDragMove` / `endDrag` / `cleanupDrag`：完整的拖拽状态机；
5. `showUndoBar` / `hideUndoBar` 与 `dom.undoButton` 的点击处理；
6. 最后看 `renderSettings` 与 `renderToday`，理解「原地更新」和「重建」的区别。

## 下一课

第 6 课接入原生壳层：托盘图标与菜单、`CommandOrControl+Shift+Space` 全局快捷键，以及开机启动。设置面板会因此多出两个开关。
