# 练习 02：文件路径、JSON 与恢复决策

本组 5 题只计算路径、解析字符串、选择结果，不实际读写清单。可以使用骨架顶部已经引入的 `node:path`，不需要安装第三方包。

## 打开哪个文件、怎么做

打开本目录的 `starter.js`，从 `makeStatePaths` 开始。保留函数声明和 `module.exports`，把当前函数里的占位 `throw` 换成你的逻辑和返回值。不要在文件顶层写死一份答案，不改 `starter.test.js`。

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/02-storage/starter.test.js
```

只跑第 1 题：

```powershell
node --test --test-name-pattern='^makeStatePaths ' exercises/02-storage/starter.test.js
```

本组有 5 条判分测试。一次做一题，其余没做的报错可以先忽略。软件目录里的 `npm test` 不会检查这些习题。

## 题目

### 1. `makeStatePaths(directory)`

**输入：** 一个有效的目录路径字符串，可以是相对路径，也可以是绝对路径。无需创建目录、检查目录存在或读取文件。

**返回：** 一个对象，恰好用下面三个键，每个值是绝对路径字符串：

| 键 | 目录下的文件名 |
| --- | --- |
| `primary` | `state.json` |
| `backup` | `state.backup.json` |
| `temporary` | `state.tmp.json` |

假如当前 PowerShell 在 `F:\杂\转开发\DoTodo-learning`，调用 `makeStatePaths('./practice-data')` 的结果是：

```js
{
  primary: 'F:\\杂\\转开发\\DoTodo-learning\\practice-data\\state.json',
  backup: 'F:\\杂\\转开发\\DoTodo-learning\\practice-data\\state.backup.json',
  temporary: 'F:\\杂\\转开发\\DoTodo-learning\\practice-data\\state.tmp.json'
}
```

上面是 JavaScript 字符串表示，`\\` 表示路径里的一个反斜杠。盘符与父目录取决于运行位置，不能把这个例子的绝对路径写死进函数。

**提示：** `path.resolve` 可以把相对目录转为绝对目录，`path.join` 用来拼目录和文件名。骨架已经有 `const path = require('node:path')`，不用再声明一次。

### 2. `safeParseJson(text)`

**输入：** 一个字符串，可能是合法 JSON，也可能有语法错误。

**返回：**

| 情况 | 返回 |
| --- | --- |
| 解析成功 | `{ ok: true, value: 解析结果 }` |
| 解析失败 | `{ ok: false, error: 捕获到的Error对象 }` |

`error` 必须是 `Error` 实例，不能只返回 `.message` 字符串。不要把异常继续抛给调用者。合法 JSON 解析出来不一定是对象，也可以是数组、数字、布尔或 `null`。

```js
safeParseJson('{"done":true}') // { ok: true, value: { done: true } }
safeParseJson('42')            // { ok: true, value: 42 }
safeParseJson('{broken')       // { ok: false, error: 一个 SyntaxError 实例 }
```

最后一个例子是在说明结果类型，错误消息由 Node 决定，不用自己拼。`ok: true` 只表示 JSON 语法正确，不表示业务数据正确。

**提示：** `JSON.parse` 失败会抛异常，用 `try/catch` 把它变成返回值。

### 3. `classifyCandidate(text, validate)`

**输入：**

- `text`：文件内容字符串；只有参数值 `null` 表示文件不存在，字符串 `'null'` 仍然是文件内容。
- `validate`：调用者传进来的函数。调用方式是 `validate(解析后的值)`，返回一个带布尔 `ok` 的对象。本题假定校验函数不会抛异常，不用自己写产品字段规则。

按顺序处理：

| 情况 | 返回 |
| --- | --- |
| `text === null` | `{ kind: 'missing' }`，不解析、不调用校验函数 |
| JSON 解析失败 | `{ kind: 'corrupt' }`，不调用校验函数 |
| 解析成功，`validate(value).ok !== true` | `{ kind: 'corrupt' }` |
| 解析成功且校验通过 | `{ kind: 'valid', value: 解析后的值 }` |

成功结果中的 `value` 是解析值，不能换成校验函数返回的 `{ ok: true }`。

```js
const validate = value => ({ ok: value.version === 1 });
classifyCandidate('{"version":1}', validate);
// { kind: 'valid', value: { version: 1 } }
classifyCandidate('{"version":2}', validate);
// { kind: 'corrupt' }
classifyCandidate(null, validate);
// { kind: 'missing' }
```

**提示：** 可以复用第 2 题。这里练的是调用传入的函数，不是把它当作已经算好的布尔值。

### 4. `chooseLoadResult(primary, backup)`

**输入：** 两个第 3 题那样的候选对象，各自的 `kind` 为 `missing`、`corrupt` 或 `valid`。只有 `valid` 才有可用的 `value`。

**返回：**

| 条件 | 返回 |
| --- | --- |
| 主文件 valid，包括主备都 valid | `{ state: primary.value, source: 'primary' }` |
| 主文件不是 valid，备份 valid | `{ state: backup.value, source: 'backup' }` |
| 两个都不是 valid | `{ state: null, source: 'empty' }` |

```js
chooseLoadResult(
  { kind: 'corrupt' },
  { kind: 'valid', value: { name: 'backup' } }
);
// { state: { name: 'backup' }, source: 'backup' }
```

不返回候选对象外面的 `kind`，也不自己造默认业务状态；空结果的 `state` 明确是 `null`。只做选择，不修改输入，也不需要深复制选中的 `value`。

**提示：** 三个顺序分支就够了，不用比较时间戳或文件内容。

### 5. `serializeState(state)`

**输入：** 可用 JSON 表示的普通对象，不包含循环引用、函数或 BigInt。本题不用处理序列化异常。

**返回：** 一个字符串。JSON 使用两格缩进，末尾额外加一个换行字符 `\n`。不修改 `state`。

```js
serializeState({ activeDay: { tasks: [] } });
// 字符串内容显示出来是：
// {
//   "activeDay": {
//     "tasks": []
//   }
// }
// 最后的 } 后面还要有一个换行
```

字符串的精确表示为 `'{\n  "activeDay": {\n    "tasks": []\n  }\n}\n'`。不要用 Windows 的 `\r\n` 替代本题规定的 `\n`。

**提示：** 查 `JSON.stringify` 的三个参数；返回字符串，不要调用文件写入 API。

## 做完再回答（不参与自动判分）

1. 为什么第 1 题不能把你电脑上的绝对路径写死？
2. `'{"version":2}'` 为什么可能是合法 JSON、却是无效业务状态？
3. `validate(value)` 返回的对象和 `value` 有什么不同？
4. 主文件损坏时，为什么不能悄悄覆盖成空数据？
5. 加餐：用文字描述“验证 → 写临时文件 → 同步 → 关闭 → 替换”的原子保存步骤，解释直接覆盖原文件的风险。

## 本题不要求处理的情况

- `classifyCandidate` 里 `validate` 的返回值除 `ok` 以外还带什么字段（只读 `ok`）
- `validate` 自身抛异常（本题假定它不抛）
- `serializeState` 遇到循环引用、函数、BigInt 等无法序列化的输入
- `makeStatePaths` 的`directory` 不存在、含非法字符、或为 `undefined`
