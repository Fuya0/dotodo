# 第 4 课：透明窗口、深色玻璃与 DOM 投影

## 本课完成了什么

前 3 课把「可信状态」和「权限边界」搭好了，但页面还只是一个临时壳。这一课第一次真正画出产品界面：

```text
主进程
  getSnapshot() → { activeDay, history, settings, windowBounds }
        │
        ▼  Preload / IPC（第 3 课）
渲染进程
  view-model.js   deriveTodayView(snapshot) → 纯数据视图
        │
        ▼
  app.js          把视图数据变成 DOM，把输入变成命令
        │
        ▼
  styles.css      深色玻璃、青蓝强调、薄荷绿完成、珊瑚红危险
```

对应的文件改动：

| 文件 | 作用 |
| --- | --- |
| `src/renderer/view-model.js` | 新增。纯投影函数，不碰 DOM |
| `src/renderer/app.js` | 新增。DOM 渲染、事件绑定、命令调用 |
| `src/renderer/index.html` | 新增。语义化结构 |
| `src/renderer/styles.css` | 新增。玻璃视觉系统 |
| `src/index.html` `src/renderer.js` `src/styles.css` | 删除（旧版单窗口实现） |
| `src/main.js` | `htmlPath` 指向 `renderer/index.html`，冒烟检查加严 |

## 窗口透明 ≠ 内容透明，也 ≠ 可读性由用户决定

最早两版在这里走过两条弯路，都值得记下来。

**第一条弯路：用 `BrowserWindow.setOpacity(0.94)` 做「半透明感」。**
它看起来像玻璃，实际上是把整个窗口连文字一起调淡——透明度越低，任务文字越难读。

**第二条弯路：改对了分层，但把 alpha 做成了设置项。**
分层之后文字确实不透明了，可是设置里有个 55%–100% 的滑杆。用户拉到 55%，
亮色壁纸透上来，浅色文字压在亮底上**照样看不清**——文字没被淡化，但它失去了对比度。
把可读性交给一个滑杆，本身就是错的。

最终做法是固定的两层：

```css
:root {
  /* 唯一一层玻璃背景。固定值，不开放调节。 */
  --surface: rgba(28, 28, 30, 0.88);
}

.app-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--surface);
}

/* 所有内容都在背景层之上，完全不透明 */
.app-shell > * { position: relative; z-index: 1; }
```

窗口本身仍然是透明的：

```js
new BrowserWindow({
  transparent: true,
  backgroundColor: '#00000000',
  frame: false
});
```

三个约束一起成立，界面才稳定：

| 约束 | 保证什么 |
| --- | --- |
| 窗口 `transparent: true` | 圆角外能看到桌面，卡片像是浮着的 |
| 背景层固定 88% alpha | 亮壁纸也不会把文字冲淡 |
| `setOpacity` 完全不用 | 文字、勾选框、进度条永远 100% 不透明 |

`test/renderer/markup.test.js` 会把这三条都钉住：背景层只能引用 `var(--surface)`，
`--surface-opacity` 这个变量不许再出现，渲染层不许出现 `setBackgroundOpacity`。

### 底色为什么是中性灰而不是深蓝

一开始用的是深蓝黑（`#0c1424`）。压在彩色壁纸上时，那点蓝会被壁纸衬出来，
整块面板看起来像「一个蓝色的窗口」，而不是一块玻璃。

改成中性灰（`#1c1c1e`）之后，面板在任何壁纸上都只是「更暗的一层」，
不会带上壁纸的色相。这是玻璃质感的关键：**玻璃本身没有颜色，只有明度差。**

### 怎么验证这件事

写这段样式的时候，应该真的把窗口放到亮壁纸前看一眼。本项目为此加了一个截图工具：

```powershell
node tools/capture-window.js --out=shots/today.png --backdrop=#2f6fd0
node tools/capture-window.js --out=shots/light.png --backdrop=#e9e9ec
```

`--backdrop` 会先给页面根元素铺一个纯色底再截图。因为窗口本身是透明的，
不铺底的话截出来只有半透明的暗色像素，看不出「压在亮壁纸上还能不能读」。

## 拖动窗口靠 CSS，不靠 JS

无边框窗口没有系统标题栏，用户就没法拖动。Electron 提供的是 CSS 属性，而不是 API：

```css
.titlebar { -webkit-app-region: drag; }
.window-actions { -webkit-app-region: no-drag; }
```

`drag` 区域内按下鼠标即拖动窗口；但按钮必须显式回到 `no-drag`，否则点不动。这是一个很容易漏的点：只要有一个按钮忘了写 `no-drag`，它就会变成「按住拖动」而不是「点击」。

## 投影层：先算数据，再画界面

`deriveTodayView(snapshot)` 把完整快照压缩成界面真正需要的字段：

```js
{
  date: '2026-09-13',
  dateLabel: '9月13日 周日',
  tasks: [{ id, position, text, completed, completedAt, isContinued, continuedFromDate }],
  todayCount: 4,
  completedCount: 2,
  remainingCount: 2,
  progressRatio: 0.5,
  progressPercent: 50,
  progressLabel: '2 / 4',
  hasTasks: true,
  isEmpty: false,
  empty: null
}
```

为什么不让 `app.js` 直接从快照里取字段？因为投影函数是**纯函数**：同样的输入永远得到同样的输出，不读 DOM、不读时钟、不发网络请求。它可以在 Node 里直接测试，而不需要启动 Chromium。

### 一个文件，两种加载方式

`view-model.js` 既被测试 `require()`，也被页面用 `<script>` 加载。靠文件最后这四行：

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deriveTodayView, formatDateLabel };
}
```

- 在 Node 里，`module` 存在，于是导出给 `require()`；
- 在浏览器普通脚本里，`module` 不存在，`typeof` 检查让这一行安全跳过；
- 浏览器那一边不需要导入语句，因为**普通脚本顶层的函数声明会变成全局变量**，`app.js` 直接就能调用 `deriveTodayView`。

这也是为什么没有引入打包器：原生 JavaScript 里，这个模式足以让「可测试的纯逻辑」和「浏览器界面」共用同一个文件。如果以后改用 ES Module，浏览器要写 `import`，Node 则要处理模块类型，那才需要构建步骤。

## DOM 创建：`textContent` 而不是 `innerHTML`

任务文字是用户输入，必须当成不可信数据：

```js
const text = document.createElement('span');
text.textContent = row.text;   // 正确：按纯文本插入
```

```js
text.innerHTML = row.text;     // 危险：用户写 <img onerror=...> 就变成代码
```

页面还带一条很严的 CSP：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self'; ..." />
```

它禁止内联脚本、禁止远程资源。所以 `app.js`、`view-model.js`、`styles.css` 必须是**分离的本地文件**，页面里不能出现 `<script>...</script>` 这种本体。`markup.test.js` 会检查这一点。

只有图标是内联字符串，因为那是我们自己写死的 SVG：

```js
check.innerHTML = CHECK_ICON;
```

## 事件委托与游标式 tabindex

任务行是每次重绘都重新创建的，所以不能给每行单独绑键盘监听。做法是把监听器放在容器上，用事件冒泡一次覆盖所有行：

```js
dom.list.addEventListener('keydown', (event) => {
  if (event.target.classList.contains('edit-input')) return;   // 编辑框里的按键归输入框
  const item = event.target.closest('.todo-row');
  if (!item) return;
  ...
});
```

`event.target.closest('.todo-row')` 从真正被按的元素往上找最近的任务行。这正是「委托」的含义：**监听器数量固定，和任务数量无关**。

Tab 键的行为用「游标式 tabindex」：

```js
item.tabIndex = index === 0 ? 0 : -1;   // 只有一行能被 Tab 命中
```

```js
dom.list.addEventListener('focusin', (event) => {
  const item = event.target.closest('.todo-row');
  for (const row of dom.list.querySelectorAll('.todo-row')) {
    row.tabIndex = row === item ? 0 : -1;
  }
});
```

这样 Tab 只会在「列表」和「列表外控件」之间跳一次，进入列表后靠方向键在行间移动。如果每一行都 `tabIndex = 0`，20 条任务就要按 20 次 Tab 才能穿过去。

### 键盘映射

| 按键 | 行为 |
| --- | --- |
| `Enter`（在输入框里） | 添加任务 |
| `Space` | 切换当前行的完成状态 |
| `F2` 或双击文字 | 进入行内编辑 |
| `Delete` / `Backspace` | 删除当前行 |
| `↑` / `↓` | 在行之间移动焦点 |
| `Escape` | 取消编辑；关闭设置面板 |
| `Ctrl/⌘ + N` | 聚焦输入框 |

编辑的实现是「就地替换」：把文字节点换成一个 `<input>`，`Enter` 提交、`Escape` 放弃、失焦提交。注意 `settled` 标志：

```js
let settled = false;
const finish = async (commit) => {
  if (settled) return;      // 防止 Enter 之后紧接着 blur 再提交一次
  settled = true;
  ...
};
```

没有这个标志，按 `Enter` 会同时触发 `keydown` 和随后的 `blur`，同一次编辑被提交两遍。

## 无障碍属性不是装饰

| 属性 | 描述什么 |
| --- | --- |
| `role="listbox"` + `role="option"` | 这是一组可选择的项目 |
| `aria-selected` | 当前焦点在哪一行 |
| `aria-pressed` | 勾选框/层级按钮当前是开还是关 |
| `aria-label` | 只有图标的按钮到底叫什么 |
| `aria-valuenow` / `aria-valuemin` / `aria-valuemax` | 进度条现在到哪了 |
| `aria-live="polite"` | 列表变化时通知屏幕阅读器 |

一个只有 `<svg>` 的删除按钮，对屏幕阅读器来说是完全无意义的。`aria-label="删除：买菜"` 才让它可读。这些属性同时也让界面更容易被自动化测试断言——后面的冒烟测试就是靠 `#dateLabel`、`#progressLabel` 判断界面是否真的渲染了。

## 悲观更新：先确认再清空

添加任务的流程：

```js
dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = dom.input.value.trim();
  if (!value) return;
  const result = await addTask(value);
  if (result && result.ok) dom.input.value = '';   // 主进程确认后才清空
  dom.input.focus();
});
```

反过来的写法（先清空、再请求）看起来更「流畅」，但一旦磁盘写入失败，用户刚打的一整句话就没了，只看到一条错误提示。桌面应用的数据往往只此一份，宁可慢半拍。

这与「乐观更新」是两种取向：乐观更新假设成功、先改界面、失败再回滚，适合网络请求；对本地持久化的关键数据，悲观更新更稳。DoTodo 用的是悲观更新——所有命令都返回最新快照，界面永远画的是主进程确认过的状态。

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo
npm start
```

界面里应该看到：悬浮的深蓝黑玻璃卡片、标题栏左侧 `DoTodo`、右侧四个按钮、日期与星期、进度条、添加框、任务列表、底部「今天 / 历史」标签。

自动化部分：

```powershell
node test/renderer/view-model.test.js
node test/renderer/markup.test.js
npm run smoke
```

`markup.test.js` 是一组**静态约束**检查，专门补偿「渲染层没有 DOM 单测」这件事：

- `app.js` 里 `querySelector('#x')` 的每个 id 都必须在 `index.html` 里存在；
- 渲染脚本不得出现 `require(`、`process.`、`ipcRenderer`；
- 渲染脚本只调用 `window.dotodo` 里这一课允许的方法；
- 页面不得有内联脚本，且 `view-model.js` 必须先于 `app.js` 加载；
- 玻璃背景只能引用 `var(--surface)`，`--surface-opacity` 与 `setBackgroundOpacity` 都不许再出现；
- 提示条必须在网格流内（`grid-row: 1`），不许用绝对定位盖住标题。

这类测试不验证「好不好看」，但能拦住手误改名、忘记改选择器、偷偷引入 Node 这类最容易发生、又只有在运行时才炸的错误。

## 真正点一下：交互场景

静态检查只能证明「文件内容对得上」，纯函数测试只能证明「投影算得对」。**在浏览器里点一下会发生什么，
这两者都证明不了。**

本项目为此加了一层：把一段脚本丢进真实渲染进程执行，让它去点、去按键，然后断言 DOM。

```powershell
npm run ui-check
```

```text
── today.js
  ✓ 添加后列表多一行
  ✓ 新任务出现在列表底部
  ✓ 勾选后该行标记为完成
  ✓ 双击进入行内编辑
  ✓ Enter 提交编辑
  ✓ Escape 放弃修改
  ✓ Space 切换完成状态
  ✓ F2 进入编辑
  ✓ Alt+↓ 把第一行下移一位
  ✓ 撤销后回到原来的位置
  ...
```

### 它是怎么接起来的

三块，各自很小：

**① 主进程加一个通道**（`src/main.js`）：

```js
if (driveScript) {
  const source = fs.readFileSync(driveScript, 'utf8');
  const outcome = await smokeWindow.webContents.executeJavaScript(`(async () => {\n${source}\n})()`);
  console.log(`DOTODO_DRIVE_RESULT ${JSON.stringify(outcome)}`);
}
```

**② 场景就是一个函数体**（`test/ui/today.js`），结尾 `return results;`：

```js
input.value = '写周报';
form.requestSubmit();
await expect('添加后列表多一行', () => rows().length === startCount + 1);
```

**③ 运行器**（`tools/ui-check.js`）为每个场景建一个隔离数据目录、写入演示清单、启动 Electron、
把前置代码和场景拼起来执行、再把返回的断言数组打成一张表。

### 三个关键取舍

**断言要等条件，不要等时间。** 界面变化是异步的（一次 IPC 往返 + 一次重绘），
`sleep(500)` 在快机器上浪费时间、在慢机器上又会假失败：

```js
async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { if (predicate()) return true; } catch { /* 元素还没出现 */ }
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}
```

**每个场景一个隔离数据目录。** 场景会真的改数据（添加、删除、排序），共用一个目录的话
场景之间会互相污染，而且结果取决于执行顺序。

**失败时留下证据。** 每个场景跑完都截一张图（`shots/ui/<场景名>.png`）。断言失败时，
看一眼截图往往比重读断言更快定位问题。

### 场景文件也要有守卫

场景写错（忘了 `return results`、用了 `require`、选择器拼错）只有在启动 Electron 之后才会暴露，
太慢。`test/tools/ui-scenarios.test.js` 用静态检查提前拦：

- 每个场景必须以 `return results;` 结尾；
- 场景里不许出现 `require(` 或 `process.`（渲染进程里没有 Node）；
- 场景查询的每个 `#id` 和 `.class` 都必须真实存在——`#id` 查 `index.html`，
  `.class` 还要算上 `app.js` 运行时拼出来的那些（`` `history-row${...}` `` 这种模板字符串）。

最后一条一开始写错过两次，值得记下来：它先是被「断言这个元素**不**存在」误伤，
后来又把模板字符串拼出来的类名当成不存在。**守卫本身也是代码，也会错。**
判断「缺失断言」用的是后面跟的是 `=== null` 还是 `.length === 0`——
所以 `!q('#x').hidden`（断言存在且可见）仍然会被校验，而 `q('#x') === null` 会被跳过。

## 常见错误

- 继续用 `setOpacity()` 调透明度，导致文字一起变淡；
- 把背景 alpha 做成设置项，用户一拉就把文字对比度调坏；
- 用深蓝黑当玻璃底色，压在彩色壁纸上显出蓝色调，看起来像「蓝色窗口」；
- 把提示条写成 `position: absolute`，于是它盖住了页面标题；
- 按钮忘记 `-webkit-app-region: no-drag`，点不动；
- 用 `innerHTML` 写入用户文本，引入 XSS；
- 把 `<script>` 写成内联本体，被 CSP 拦掉；
- 每一行都给 `tabIndex = 0`，Tab 键变成折磨；
- 没有 `settled` 标志，一次编辑提交两遍；
- 重绘后不恢复焦点，按一次 `Space` 焦点就丢了；
- 在渲染层拼日期字符串用 `toISOString()`，把 UTC 日期当成用户的今天。

## 阅读顺序

1. `src/renderer/index.html`：先看界面结构，注意每个 `id`；
2. `test/renderer/view-model.test.js`：产品定义的「今天」长什么样；
3. `src/renderer/view-model.js`：投影函数和 `module` 守卫；
4. `src/renderer/app.js` 的 `render()` 与 `createRow()`：数据怎么变成 DOM；
5. 再看 `dom.list` 的两个监听器：委托与游标式 tabindex；
6. 最后看 `styles.css` 的 `.app-shell::before` 和 `@media (prefers-reduced-motion)`。

## 下一课

历史页目前还是禁用的标签。第 5 课会实现按日期倒序的 History、撤销条的完整生命周期、指针拖拽排序和设置面板。
