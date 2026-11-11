# 练习 04：手写界面投影与键盘导航

## 目标

第 4 课把状态快照画成界面。生产的投影代码在 `src/renderer/view-model.js`，而你要写的是另一套同类型函数：同样的思路，不同的形状，练习 `map`、`filter`、`reduce`、`Math`、解构和模板字符串。

## 使用方法

打开 `starter.js`，把 9 个占位函数实现完，然后在 PowerShell 运行：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/04-renderer/starter.test.js
```

要只跑某一题，可使用 Node 测试运行器的名称过滤，例如：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node --test --test-name-pattern='describeSurface' exercises/04-renderer/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`，做不做都不影响应用运行。题目只要求修改 `starter.js` 中的占位函数；不要修改测试来迁就实现。

## 题目

### 1. `summarizeProgress(flags)`

输入是一个数组，数组元素按真假值判断是否完成；元素不是对象，也没有额外字段。返回一个新对象，键名和类型必须是：

```js
{ total, completed, remaining, ratio, percent, label }
```

- `total`、`completed`、`remaining`、`percent` 是 `number`；`ratio` 是 `0` 到 `1` 的 `number`；`label` 是 `string`。
- `total` 是输入数组长度；`completed` 是真值元素的数量；`remaining = total - completed`。
- 空数组的 `ratio` 必须是 `0`，不能得到 `NaN`。非空时是 `completed / total`。
- `percent` 是 `ratio * 100` 四舍五入后的整数。
- `label` 精确使用 `${completed} / ${total}`，斜杠两边各一个空格；空数组为 `'0 / 0'`。
- 判断完成用真假值，而不是 `value === true`：`1`、`'x'` 算完成，`0`、`null`、`undefined` 不算。

示例：

```js
summarizeProgress([true, 0, 'done'])
// { total: 3, completed: 2, remaining: 1,
//   ratio: 2 / 3, percent: 67, label: '2 / 3' }

summarizeProgress([])
// { total: 0, completed: 0, remaining: 0, ratio: 0, percent: 0, label: '0 / 0' }
```

提示：先得到总数和完成数，再处理除法的空数组边界；不要把百分数直接当成比例。

### 2. `toRows(tasks)`

输入是任务数组；合法任务至少要有 `id` 和 `text` 字段。每个输出元素必须是只含下列键的新对象：

```js
{ index, id, text, done }
```

- `id` 必须是非空字符串；`text` 必须是字符串，去掉首尾空白后仍非空。任务为 `null`、字段缺失、ID 为空或文本为空时丢掉整条。
- 输出的 `text` 是去掉首尾空白后的字符串；`id` 保留原字符串。
- `done` 用任务的 `completed` 字段按真假值判断，缺失时为 `false`。
- `index` 是该任务在返回数组中的位置，不是输入数组下标；被丢弃的任务不占编号。
- 输入数组只读，不能通过排序、删除或修改任务对象来完成题目。

示例：

```js
toRows([
  { id: 'a', text: '  写周报  ', completed: 0 },
  null,
  { id: '', text: '无效' },
  { id: 'b', text: '买菜', completed: 1 }
])
// [
//   { index: 0, id: 'a', text: '写周报', done: false },
//   { index: 1, id: 'b', text: '买菜', done: true }
// ]
```

提示：先过滤再映射时，要确保编号来自过滤后的结果；或者在一次遍历中维护一个独立的输出编号。

### 3. `groupByCompleted(tasks)`

输入是任务数组，每项从 `id` 和 `completed` 读取数据。返回一个新对象，键名固定为 `done` 和 `pending`，值都是数组：

```js
{ done: ['a', 'c'], pending: ['b'] }
```

- `completed` 为真值时把该项的 `id` 放入 `done`，否则放入 `pending`。
- 每个桶保存的是 ID 字符串；保持任务在输入中的相对顺序。
- 空数组返回 `{ done: [], pending: [] }`。
- 题目假定任务项含有可读的 `id`；不需要改造输入或排序。

示例：

```js
groupByCompleted([
  { id: 'a', completed: 1 },
  { id: 'b', completed: 0 },
  { id: 'c', completed: 'yes' }
])
// { done: ['a', 'c'], pending: ['b'] }
```

提示：一个循环同时向两个桶追加即可；不要用排序改变原数组。

### 4. `nextFocusIndex(current, total, delta)`

返回键盘上下移动后的下标，返回类型为 `number`。

- 当 `total <= 0` 时返回 `-1`。
- 其他情况计算 `current + delta`，然后一次性夹到 `[0, total - 1]`：低于 0 取 0，高于 `total - 1` 取 `total - 1`。
- 两端夹紧，不循环；例如最后一项继续向下仍是最后一项。
- `current` 可能越界，这是防御性输入。不要先把 `current` 单独夹一次；测试要求只在最后夹结果。

示例：

```js
nextFocusIndex(1, 3, -1) // 0
nextFocusIndex(2, 3, 1)  // 2
nextFocusIndex(9, 3, 1)  // 2
nextFocusIndex(-4, 3, 1) // 0
nextFocusIndex(0, 0, 1)  // -1
```

提示：先处理空列表，再计算候选值；`Math.min` 和 `Math.max` 可以表达最后一次夹紧。

### 5. `describeSurface({ r, g, b, alpha })`

输入是颜色字段对象，输出是可直接写进样式表的对象；非法或缺失的整体输入返回 `null`，否则返回：

```js
{ css: 'rgba(...)', declaration: '--surface: rgba(...)' }
```

- `r`、`g`、`b` 缺失时按 `0` 处理；各自四舍五入为整数，再夹到 `0`–`255`。
- `alpha` 必须是有限的 `number`。缺失、`NaN`、字符串等非法 alpha 返回 `null`。
- 合法 alpha 夹到 `0.55`–`1`，最多保留两位小数，并去掉末尾多余的 0：`1` 写成 `'1'`，不是 `'1.00'`。
- `css` 精确格式为 `rgba(r, g, b, alpha)`：逗号后一个空格，`rgba` 与左括号之间没有空格。
- `declaration` 精确是 `'--surface: ' + css`。
- `undefined`、`null` 等无法解构的输入也必须返回 `null`，不要让函数抛出异常。

示例：

```js
describeSurface({ r: 28, g: 28, b: 30, alpha: 0.88 })
// { css: 'rgba(28, 28, 30, 0.88)',
//   declaration: '--surface: rgba(28, 28, 30, 0.88)' }

describeSurface({ r: 300, g: -10, b: 30.6, alpha: 0.5 })
// { css: 'rgba(255, 0, 31, 0.55)',
//   declaration: '--surface: rgba(255, 0, 31, 0.55)' }

describeSurface({ r: 1, alpha: '0.8' }) // null
```

提示：先验证 `alpha`，再做格式化；`Number.isFinite` 不会把数字字符串误当成合法数字。

> **这是个真实的坑：不要在参数位置直接解构。**
>
> ```js
> function describeSurface({ r, g, b, alpha } = {}) { ... }   // 传 null 会抛 TypeError
> function describeSurface(surface) {                          // 正确：先判空再取字段
>   if (surface === null || typeof surface !== 'object') return null;
>   const { r, g, b, alpha } = surface;
>   ...
> }
> ```
>
> 默认参数 `= {}` **只对 `undefined` 生效**，对 `null` 无效——`null` 会被直接解构，抛 `Cannot destructure property ... of 'null'`。测试里 `describeSurface(null)` 就在验证这一点。
>
> 另外 alpha 为 `1` 时 `toFixed` 会给你 `'1.00'`（字符串），所以要用数值运算
> `Math.round(x * 100) / 100` 再 `String()` 转换。

### 6. `buildClassName(state)`

输入是状态对象，读取 `completed`、`selected`、`continued` 三个字段的真假值，返回一个 `string`。

- 基础类永远是 `todo-row`，放在最前。
- 修饰类严格按 `completed`、`selected`、`continued` 的顺序追加，只追加真值对应的类。
- 类之间只有一个空格，不能出现多余空格或末尾空格。

示例：

```js
buildClassName({ completed: true, selected: false, continued: false })
// 'todo-row completed'

buildClassName({ selected: true, continued: true })
// 'todo-row selected continued'

buildClassName({}) // 'todo-row'
```

提示：用数组收集有效类名，最后用 `join(' ')`；不要手工处理每种组合。

## 第二部分：把「看得清」算出来

这一组来自一次真实的修复。最早的问题是「面板调透明之后字看不清」——听起来像审美，其实是可以算的：面板半透明，最坏情况是它压在纯白壁纸上，那时浅色文字还剩多少对比度，用 WCAG 公式就能得出一个数字。旧配色在那个底色上只有 2.8:1，低于可访问性下限 4.5:1。

### 7. `parseColor(value)`

输入通常是浏览器 `getComputedStyle` 返回的 `rgb(...)` 或 `rgba(...)` 字符串；返回对象或 `null`：

```js
{ r, g, b, a }
```

- `rgb(...)` 的 alpha 补为数字 `1`；`rgba(...)` 读取第四个数字。
- 数字之间以及整个字符串两侧可以有空白，逗号周围可以有空白，也可以没有空白。
- 必须是数字文本；数字个数不对、出现字母、十六进制、`transparent`、空字符串或非字符串输入都返回 `null`。
- 不要求支持百分比、CSS 新式空格斜杠语法或十六进制，因为本项目计算样式只给 `rgb()`/`rgba()`。

示例：

```js
parseColor('rgb(255, 0, 0)')
// { r: 255, g: 0, b: 0, a: 1 }

parseColor('  rgba( 1 , 2 , 3 , 0.25 )  ')
// { r: 1, g: 2, b: 3, a: 0.25 }

parseColor('#f5f5f7') // null
parseColor('rgb(a, b, c)') // null
```

提示：先去掉首尾空白并判断整体格式，再按逗号拆分；拆出的每个字段都要确认能成为有限数字，不能依赖 `parseInt` 默默接受尾随字母。

### 8. `compositeOver(foreground, background)`

两个输入都是颜色对象 `{ r, g, b, a }`。题目假定 `background` 不透明；返回一个新对象，`a` 恒为数字 `1`。

每个通道分别使用：`foreground.channel * foreground.a + background.channel * (1 - foreground.a)`。不要把整个背景对象当成一个数字，也不要对结果取整。

示例：

```js
compositeOver(
  { r: 255, g: 255, b: 255, a: 0.5 },
  { r: 0, g: 0, b: 0, a: 1 }
)
// { r: 127.5, g: 127.5, b: 127.5, a: 1 }

compositeOver(
  { r: 10, g: 20, b: 30, a: 0 },
  { r: 1, g: 2, b: 3, a: 1 }
)
// { r: 1, g: 2, b: 3, a: 1 }
```

提示：把通道名放进一次小计算，或明确分别计算 `r`、`g`、`b`；返回新对象，不要把结果写回任意输入对象。

### 9. `contrastRatio(foreground, background)`

输入是两个颜色对象，返回一个 `number`，表示 WCAG 对比度。alpha 不参与本题公式；如需处理半透明颜色，先用第 8 题合成。

- 每个 RGB 通道先除以 `255` 归一化。
- Gamma 校正：`c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`。
- 相对亮度：`0.2126R + 0.7152G + 0.0722B`。
- 对比度：`(较亮亮度 + 0.05) / (较暗亮度 + 0.05)`，所以参数前后顺序不影响结果。

示例：

```js
contrastRatio({ r: 255, g: 255, b: 255, a: 1 },
              { r: 0, g: 0, b: 0, a: 1 })
// 21

contrastRatio({ r: 120, g: 120, b: 120, a: 1 },
              { r: 120, g: 120, b: 120, a: 1 })
// 1
```

提示：把“颜色转亮度”提取成局部函数，分别算两个亮度后用 `Math.max`/`Math.min`；不要用未经 gamma 校正的 RGB 平均值代替亮度。

**这里有个坑：返回值必须是原始 `number`，不要自己 `toFixed` 或加百分号。**
测试拿到结果后自己调 `.toFixed(2)` 再比较；你如果返回 `'21.00'`（字符串），
`.toFixed` 根本不存在，测试会直接报 `is not a function`。

## 代码阅读题

生产引用已核对：`src/renderer/app.js` 中存在 `createRow`、列表事件监听和渲染流程；`src/renderer/view-model.js` 中存在投影函数与浏览器/Node 双加载判断；`src/renderer/styles.css` 中存在玻璃背景与撤销动画相关样式。

打开 `src/renderer/app.js`、`src/renderer/view-model.js` 和 `src/renderer/styles.css`，回答：

1. `createRow` 里为什么用 `textContent` 而不是 `innerHTML` 写入任务文字？`innerHTML` 会带来什么风险？
2. 复选框、删除按钮、双击文字这三类交互，各自是在哪一层监听的？为什么列表的键盘事件只用了一个监听器？
3. `renderToday()` 开头为什么要先记住 `focusedId`，结束前再 `focus()` 回去？
4. 表单提交后，为什么 `dom.input.value = ''` 要等 `await addTask(...)` 返回并确认 `ok` 或 `applied` 后再做？
5. `styles.css` 顶部的注释说玻璃的 alpha 是固定的，以前挂过 `--surface-opacity` 由设置里的滑杆控制。为什么“把可读性做成用户能调坏的设置项”是设计错误？

## 复盘问题

1. 列表框为什么用“游标式 tabindex”（只有一行 `tabIndex = 0`），而不是让每一行都能被 Tab 命中？
2. `aria-selected`、`aria-pressed`、`aria-valuenow` 分别描述什么状态？只写 `class` 不写这些属性，会损失什么？
3. `view-model.js` 同时被 `require()` 和 `<script>` 加载，靠的是哪一行判断？`module` 不存在时为什么不能直接访问 `module.exports`？
4. 为什么投影函数不允许直接操作 DOM？如果它直接改 DOM，测试会难在哪里？
5. 玻璃背景的 alpha 来自 `.app-shell::before`，如果改成 `body { opacity: 0.82 }` 会发生什么？

## 本题不要求处理的情况

- `toRows` 的 `id` 是纯空白字符串（测试只覆盖了 `''`）；`id` 不做 trim，按原字符串判断
- `toRows` / `groupByCompleted` 的入参本身不是数组（题面保证是数组，只需处理元素里的 `null`）
- `parseColor` 的负数、`.5` 这种省略前导 0 的写法、大写 `RGB(...)` 前缀（只支持小写 `rgb`/`rgba` 加正常数字文本）
- `describeSurface` 的 `r` / `g` / `b` 收到非数字（题面只保证是数字或缺失）
- `buildClassName` 收到 `null` 或非对象
- `nextFocusIndex` 的 `total` 是 `NaN` 或小数（题面保证是整数）
