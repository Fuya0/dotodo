# DoTodo Electron 习题集

八组习题，和 `docs/learning/electron/` 的课一一对应。每一组都是同一套结构：

```text
exercises/electron/NN-xxx/
  README.md        题目说明：每个函数要满足什么、边界是什么
  starter.js       你要填的文件，每个函数体现在都是 throw
  starter.test.js  判分测试，不要改它
```

## 怎么用

```powershell
# 例如第 4 课
node exercises/electron/04-renderer/starter.test.js
```

一开始全是红的：

```text
# tests 10
# pass 0
# fail 10
```

把 `starter.js` 里的函数一个个写完，直到：

```text
# tests 10
# pass 10
# fail 0
```

就完成了。

## 三条规矩

1. **不要改 `starter.test.js`。** 它是判分标准。如果你觉得某条断言不对，先想清楚是不是自己理解错了；
   真觉得有问题就在聊天里说出来，我们一起看。
2. **先写再看生产代码。** 每道题都刻意和生产代码**形状不同**，就是为了防止照抄。
   卡住超过 15 分钟再看 `src/` 里对应的实现，然后合上文件自己重写一遍。
3. **不要 require 第三方包。** 这些题只用 JavaScript 标准能力（`Math`、`Array`、`Object`、`String`、
   `Number`；第 02 题可能用到 `node:path` 时会在题目里说明）。

## 题目索引

| 组 | 对应课程 | 题目 | 判分测试 | 主要练什么 |
| --- | --- | --- | --- | --- |
| [01](01-process-model/) | 第 1 课 | 5 | 5 | `clamp`、`findTask`、`moveItem`、`rollover`、`isPlainObject` |
| [02](02-storage/) | 第 2 课 | 5 | 5 | `path.join`、安全 JSON 解析、候选分类、恢复选择、序列化 |
| [03](03-ipc/) | 第 3 课 | 4 | 4 | 能力归类、窄 API、严格布尔、IPC handler 注册与销毁 |
| [04](04-renderer/) | 第 4 课 | 6 | 10 | `map`/`filter`/`reduce`、`Math`、解构、模板字符串、class 拼接 |
| [05](05-interactions/) | 第 5 课 | 6 | 15 | `splice` 移动、落点计算、时间窗口、`reduce`、状态机 |
| [06](06-native-shell/) | 第 6 课 | 6 | 13 | 菜单投影、条件判断、读回校验、平台能力探测、字符串格式化 |
| [07](07-testing/) | 第 7 课 | 6 | 20 | 错误码分类、汇总统计、字节格式化、恢复决策、环境准备 |
| [08](08-build-and-release/) | 第 8 课 | 6 | 15 | 模板替换、`flatMap`、比较与排序、路径分类、集合差集 |

合计 **44 道题 / 87 条判分测试**。

一次跑完全部（会看到一堆红，做完再看）：

```powershell
Get-ChildItem -Recurse -Filter starter.test.js exercises | ForEach-Object { node $_.FullName }
```

## 做完之后

这些题的答案**不会**放进仓库。想看生产实现时，对照这几处：

| 组 | 生产代码 |
| --- | --- |
| 01 | `src/domain/state-schema.js`、`src/domain/daily-todo-engine.js` |
| 02 | `src/infrastructure/json-state-store.js` |
| 03 | `src/electron/ipc.js` |
| 04 | `src/renderer/view-model.js` |
| 05 | `src/renderer/app.js`、`src/renderer/view-model.js` |
| 06 | `src/electron/shell-controller.js` |
| 07 | `tools/verify-electron.ps1`、`src/infrastructure/json-state-store.js` |
| 08 | `package.json` 的 `build` 段、`tools/verify-electron.ps1` |

生产代码通常比习题多不少东西——错误处理、平台差异、注释、以及为了可测试而做的拆分。
读完可以问自己一句：**习题里我写的版本，缺的到底是什么？**

## 每组习题的「代码阅读题」

每组 README 末尾还有两类问题，不用写代码，但要能答上来：

- **代码阅读题**：给出生产代码里的一个具体决定，问「为什么这样写」「换一种会怎样」；
- **复盘问题**：把这一课的概念串起来，检验你是否理解了取舍而不是记住了写法。

这两部分是这套习题里最容易被跳过、但价值最高的地方。等你写完全部代码再回头看一遍，
会发现很多问题有了新的答案。
