# 练习 01：JavaScript 数据操作与可测试设计

## 目标

手写几个领域层常用的小函数，熟悉参数、返回值、数组方法、边界校验和纯函数。

## 使用方法

1. 打开同目录的 `starter.js`；
2. 不复制产品源码，逐个实现函数；
3. 每完成一个函数运行：

```powershell
node --test exercises/electron/01-process-model/starter.test.js
```

失败信息会告诉你哪个行为还不正确。全部通过后，可再尝试不用 `splice` 重写 `moveItem`。

## 题目

### 1. `clamp(value, minimum, maximum)`

把数值限制在闭区间内。例如 `clamp(120, 55, 100)` 返回 `100`。

需要理解：`Math.min`、`Math.max`、函数返回值。

### 2. `normalizeTaskText(value)`

- 非字符串返回 `{ ok: false }`；
- 去除首尾空格；
- 空文本或超过 20 个字符返回失败；
- 合法时返回 `{ ok: true, text }`。

需要理解：`typeof`、`trim`、字符串长度、提前返回。

### 3. `moveItem(items, fromIndex, toIndex)`

返回重新排序后的新数组，不能修改传入数组。索引越界时返回原内容的副本。

需要理解：展开语法、`slice`、`splice`、引用与拷贝。

### 4. `createSequence(values)`

返回一个函数。每调用一次就返回数组中的下一个值；用完时抛出错误。

需要理解：闭包、数组索引、`throw`。

### 5. `rollover(state, nextDate)`

实现一个简化跨日函数：日期相同则返回副本；日期向前时把 `activeDay` 放到 `history` 开头，并创建空的新日期；日期回退时抛出错误。

需要理解：对象/数组展开、不可变更新、字符串日期比较。

## 复盘问题

1. 为什么任务 ID 不能使用数组索引？
2. `Object.freeze` 为什么不能代替深拷贝？
3. 如果领域模块直接调用 `Date.now()`，测试会遇到什么问题？
4. `find` 与 `filter` 的返回值有什么差别？
5. 哪些 JavaScript 值经过 `JSON.stringify/parse` 后会丢失信息？
