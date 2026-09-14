# 练习 04：手写界面投影与键盘导航

## 目标

第 4 课把状态快照画成界面。生产的投影代码在 `src/renderer/view-model.js`，而你要写的是**另一套**同类型函数：同样的思路，不同的形状，逼你自己把 `map`、`filter`、`reduce`、`Math`、解构和模板字符串用一遍。

## 使用方法

打开 `starter.js`，把 9 个占位函数实现完，然后运行：

```powershell
node exercises/electron/04-renderer/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`，做不做都不影响应用运行。

## 题目

### 1. `summarizeProgress(flags)`

输入一组「是否完成」的值，返回：

```js
{ total, completed, remaining, ratio, percent, label }
```

- `ratio` 是 `0`–`1` 的小数；空数组时为 `0`（不能是 `NaN`）；
- `percent` 是 `ratio * 100` 四舍五入后的整数；
- `label` 形如 `2 / 3`；
- 判断完成用真假值，而不是 `=== true`。

### 2. `toRows(tasks)`

把任务数组转成界面行：

```js
{ index, id, text, done }
```

- `id` 必须是非空字符串，`text` 去掉首尾空白后必须非空，否则**丢掉这一条**（包括 `null`）；
- `index` 是它在**返回结果里**的位置，所以中间被丢掉后要重新连续编号；
- `done` 用真假值判断。

### 3. `groupByCompleted(tasks)`

一次遍历分桶，返回完成与未完成的 id：

```js
{ done: ['a', 'c'], pending: ['b'] }
```

空输入返回两个空数组。要求保持原顺序。

### 4. `nextFocusIndex(current, total, delta)`

键盘上下移动时的下一个焦点下标。

- 返回 `clamp(current + delta, 0, total - 1)`；**只在最后夹一次**，不要先把 `current` 夹一遍
  （只在最后夹，`current` 越界时的结果才和测试一致）；
- 两端**夹紧**，不循环；
- `total <= 0` 时返回 `-1`。

注意 `current` 越界属于防御性情况——真实使用中它总在范围内。但正因为如此，
"先夹一次还是只夹最后"这种差异平时看不出来，只有边界测试能钉住它。

### 5. `describeSurface({ r, g, b, alpha })`

把一组颜色常量拼成可以直接写进样式表的声明：

```js
describeSurface({ r: 28, g: 28, b: 30, alpha: 0.88 })
→ { css: 'rgba(28, 28, 30, 0.88)', declaration: '--surface: rgba(28, 28, 30, 0.88)' }
```

- `r` / `g` / `b` 四舍五入取整并夹到 `0`–`255`，缺失时按 `0` 处理；
- `alpha` 夹到 `0.55`–`1`，最多两位小数；
- `css` 形如 `rgba(28, 28, 30, 0.88)`（逗号后一个空格，`rgba` 与 `(` 之间没有空格）；
- `declaration` 是 `--surface: ` 加上 `css`；
- `alpha` 不是有限数字（缺失、`NaN`、字符串）时返回 `null`。

注意这一题**故意和生产代码形状不同**：生产里这些值是直接写在 CSS 里的常量，
这里要你自己做夹紧、取整和字符串拼接。先别看 `src/renderer/view-model.js`。

### 6. `buildClassName(state)`

按状态拼 class：

```js
buildClassName({ completed: true, selected: false, continued: false }) → 'todo-row completed'
```

- 基础类永远是 `todo-row`，放在最前；
- 三个修饰类按 `completed`、`selected`、`continued` 的顺序拼；
- 只拼生效的，不要出现多余空格或末尾空格。

## 第二部分：把「看得清」算出来

这一组来自一次真实的修复。最早的问题是「面板调透明之后字看不清」——听起来像审美，
其实是可以算的：面板半透明，**最坏情况是它压在纯白壁纸上**，那时浅色文字还剩多少对比度，
用 WCAG 公式就能得出一个数字。旧配色在那个底色上只有 2.8:1，远低于可访问性下限 4.5:1。

### 7. `parseColor(value)`

把 `rgb()` / `rgba()` 字符串解析成对象：

```js
parseColor('rgb(255, 0, 0)')          → { r: 255, g: 0, b: 0, a: 1 }
parseColor('rgba(28, 28, 30, 0.88)')  → { r: 28, g: 28, b: 30, a: 0.88 }
```

- 没有 alpha 时补 `1`；
- 数字之间可以有空格，也可以没有；
- 不认识的写法（十六进制、`transparent`、数字个数不对、出现非数字）→ `null`。
  计算样式给出来的一定是 `rgb()`/`rgba()`，所以不需要支持十六进制。

### 8. `compositeOver(foreground, background)`

把半透明的前景压在**不透明**的背景上，返回不透明的结果（`a` 恒为 `1`）：

```js
compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })
→ { r: 127.5, g: 127.5, b: 127.5, a: 1 }
```

公式是 `前景 * alpha + 背景 * (1 - alpha)`，逐通道。不要取整。

**这题是我自己写错的地方。** 第一版实现把「背景」当成一个数字直接乘，
而它其实是一个 `{ r, g, b }`，于是三个通道全变成 `NaN`，对比度算出来也是 `NaN`——
而 `NaN >= 4.5` 是 `false`，所以界面看起来"检测到了问题"，其实什么都没算。

### 9. `contrastRatio(foreground, background)`

WCAG 对比度：

```js
contrastRatio(白, 黑)        → 21
contrastRatio(同一个颜色, 它自己) → 1
```

- 先把每个通道从 `0–255` 归一化到 `0–1`，做 gamma 校正
  （`c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`）；
- 相对亮度 = `0.2126R + 0.7152G + 0.0722B`；
- 对比度 = `(较亮 + 0.05) / (较暗 + 0.05)`，**与前后顺序无关**。

边界很好记：最大值是 21（纯白对纯黑），最小值是 1（同色）。

## 代码阅读题

打开 `src/renderer/app.js`，回答：

1. `createRow` 里为什么用 `textContent` 而不是 `innerHTML` 写入任务文字？`innerHTML` 会带来什么风险？
2. 复选框、删除按钮、双击文字这三类交互，各自是在哪一层监听的？为什么列表的键盘事件只用了一个监听器？
3. `render()` 开头为什么要先记住 `focusedId`，结束前再 `focus()` 回去？
4. 表单提交后，为什么 `dom.input.value = ''` 写在 `await addTask(...)` 之后，而不是之前？
5. `applySurfaceOpacity` 改的是 CSS 变量，而旧实现改的是 `BrowserWindow.setOpacity()`。这两者在视觉和可访问性上差别是什么？

## 复盘问题

1. 列表框为什么用「游标式 tabindex」（只有一行 `tabIndex = 0`），而不是让每一行都能被 Tab 命中？
2. `aria-selected`、`aria-pressed`、`aria-valuenow` 分别描述什么状态？只写 `class` 不写这些属性，会损失什么？
3. `view-model.js` 同时被 `require()` 和 `<script>` 加载，靠的是哪一行判断？
4. 为什么投影函数不允许直接操作 DOM？如果它直接改 DOM，测试会变难在哪里？
5. 玻璃背景的 alpha 来自 `.app-shell::before`，如果改成 `body { opacity: 0.82 }` 会发生什么？
