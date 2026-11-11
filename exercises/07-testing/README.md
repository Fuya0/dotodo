# 练习 07：手写验证与恢复的判断逻辑

## 目标

第 7 课做的是「怎么知道自己做对了」：体积统计、损坏恢复、冒烟测试的隔离目录、可重复的验证脚本。

这些东西的价值全在于**判断的准确性**——统计错一个数字、恢复时挑错文件、冒烟测试写到真实数据目录，都会让人得出错误结论。你要写的 6 个函数就是这些判断本身，它们不碰文件系统，所以可以在 Node 里穷举。

后 6 题来自 `npm run ui-check` 那套交互场景运行器。它同样是一堆判断：哪些文件算场景、
怎么从混杂输出里取出结果、多少条断言算通过、超时怎么算、界面元素有没有压到别人身上、
数据目录里该出现什么。**其中 `isScenarioFile` 就是我当时写错的那个判断。**

## 使用方法

打开 `starter.js`，把 **12 个占位函数**实现完，然后运行：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/07-testing/starter.test.js
# 只跑某一题（按测试名称筛选）
node --test --test-name-pattern='formatBytes' exercises/07-testing/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。

## 题目

### 1. `classifyFileError(error)`

把文件操作错误归类，返回 `'missing'` / `'denied'` / `'full'` / `'unknown'`：

| 输入 | 结果 |
| --- | --- |
| `{ code: 'ENOENT' }` | `'missing'` |
| `{ code: 'EACCES' }`、`{ code: 'EPERM' }` | `'denied'` |
| `{ code: 'ENOSPC' }` | `'full'` |
| 其他 code、没有 code、`null`、非对象 | `'unknown'` |

要点：不能靠 `error.message` 判断。系统错误信息会随语言和平台变化，`code` 才是稳定的。

```js
classifyFileError({ code: 'ENOENT' })   // 'missing'
classifyFileError({ code: 'EPERM' })    // 'denied'
classifyFileError({ code: 'ENOSPC' })   // 'full'
classifyFileError({ code: 'EWHATEVER' }) // 'unknown'
classifyFileError('ENOENT')              // 'unknown' —— 字符串不是错误对象
classifyFileError(null)                  // 'unknown'
```

### 2. `summarizeVerification(steps)`

`steps` 是 `[{ name, status }]`，`status` 取值 `'passed'` / `'failed'` / `'skipped'`。返回：

```js
{ total, passed, failed, skipped, ok, firstFailure }
```

- `ok` 表示 `failed === 0`；
- `firstFailure` 是**第一个**失败步骤的 `name`，没有失败时为 `null`；
- 空数组、`null`、`undefined` 都返回全零且 `ok: true`。

空输入的精确形状是 `{ total: 0, passed: 0, failed: 0, skipped: 0, ok: true, firstFailure: null }`。

```js
summarizeVerification([
  { name: '单元测试', status: 'passed' },
  { name: '冒烟测试', status: 'failed' },
  { name: '打包',     status: 'skipped' },
  { name: '体积统计', status: 'passed' }
]);
// { total: 4, passed: 2, failed: 1, skipped: 1, ok: false, firstFailure: '冒烟测试' }

summarizeVerification([{ name: 'a', status: 'passed' }]);
// { total: 1, passed: 1, failed: 0, skipped: 0, ok: true, firstFailure: null }
```

`total` 就是数组长度。本题只出现上表那三种 `status`；其他取值不在要求范围内。

一次遍历完成，不要为了三个计数扫三遍。

### 3. `formatBytes(bytes)`

```js
formatBytes(512)       → '512 B'
formatBytes(1024)      → '1.0 KB'
formatBytes(1536)      → '1.5 KB'
formatBytes(111416252) → '106.3 MB'
formatBytes(5 * 1024 ** 3) → '5.0 GB'
```

- 1024 进制，单位依次是 `B`、`KB`、`MB`、`GB`、`TB`；
- 小于 1 KB 时是整数加 ` B`；
- 其余单位保留一位小数；
- 不是有限数字、是负数、或不是 `number` 类型时返回 `'0 B'`。

### 4. `chooseRecoverySource(candidates)`

`candidates` 形如 `{ primary, backup }`，每个值是 `'valid'` / `'corrupt'` / `'missing'`。返回：

```js
{ source: 'primary' | 'backup' | 'none', preserve: ['primary', ...], reason }
```

| primary | backup | source | preserve | reason |
| --- | --- | --- | --- | --- |
| valid | valid | `primary` | `[]` | `primary-ok` |
| valid | missing | `primary` | `[]` | `primary-ok` |
| valid | corrupt | `primary` | `['backup']` | `backup-corrupt` |
| corrupt | valid | `backup` | `['primary']` | `primary-corrupt` |
| missing | valid | `backup` | `[]` | `primary-missing` |
| corrupt | corrupt | `none` | `['primary', 'backup']` | `nothing-usable` |
| corrupt | missing | `none` | `['primary']` | `nothing-usable` |
| missing | corrupt | `none` | `['backup']` | `nothing-usable` |
| missing | missing | `none` | `[]` | `fresh` |

注意 `preserve` 的顺序固定是「先 primary 后 backup」，而且**只保留损坏的那些**——把没坏的文件也复制一份只会制造垃圾。

返回值里给的是 `reason` 代码而不是给用户看的句子。这是一个刻意的设计：**判断和措辞分开**。措辞以后要改、要翻译，判断不应该跟着变。

### 5. `buildSmokeEnvironment(baseEnv, userDataDirectory)`

给冒烟测试准备环境变量。返回 `{ ok: true, env }` 或 `{ ok: false, error }`：

- `env` 是 `baseEnv` 的浅拷贝，加上 `DOTODO_SMOKE_USER_DATA: userDataDirectory`；
- **不能修改 `baseEnv`**；
- `baseEnv` 不是对象时当作 `{}`；
- `userDataDirectory` 不是非空字符串（空串、纯空白、`null`、数字）时返回 `{ ok: false, error: <字符串> }`。

为什么宁可返回失败对象也不抛异常？因为调用方要能写「准备失败就打印一条清楚的话并退出 2」，而不是让进程崩在半路。

```js
buildSmokeEnvironment({ PATH: 'C:\\bin' }, 'C:\\tmp\\x');
// { ok: true, env: { PATH: 'C:\\bin', DOTODO_SMOKE_USER_DATA: 'C:\\tmp\\x' } }

buildSmokeEnvironment(undefined, 'C:\\tmp\\x');
// { ok: true, env: { DOTODO_SMOKE_USER_DATA: 'C:\\tmp\\x' } }

buildSmokeEnvironment({}, '   ');  // { ok: false, error: 一句话说明为什么不行 }
buildSmokeEnvironment({}, null);   // { ok: false, error: ... }
```

`error` 的内容由你决定，测试只要求它是字符串；但 `ok: false` 时必须不出现 `env`。

### 6. `countByExtension(files)`

把文件路径按扩展名归类计数：

```js
countByExtension(['a.dll', 'b.dll', 'c.pak', 'd.DLL']) → { '.dll': 3, '.pak': 1 }
countByExtension(['archive.tar.gz', 'plain.txt'])      → { '.gz': 1, '.txt': 1 }
countByExtension(['README', '.gitignore', 'a.dll'])    → { 'no-extension': 2, '.dll': 1 }
```

- 扩展名取**最后一个**点之后的部分，并转成小写（`'A.DLL'` 和 `'a.dll'` 算同一类）；
- 没有点、或者点就是第一个字符（`.gitignore`）时归到 `'no-extension'`；
- 只统计字符串条目，非字符串跳过；
- 非数组输入返回 `{}`。

### 7. `isScenarioFile(name)`

运行器要在 `test/ui/` 里挑出「渲染进程场景」，同时排除两类干扰文件。判断规则：

| 情况 | 结果 |
| --- | --- |
| 以 `.js` 结尾，且不是下面两种 | `true` |
| 以 `_` 开头（`_prelude.js` 之类的公共前置） | `false` |
| 以 `.case.js` 结尾（Node 侧配对文件） | `false` |
| 没有文件名，只有扩展名（`.js`） | `false` |
| 扩展名不是小写 `.js`（比如 `.JS`） | `false` |
| 不是字符串 | `false` |

注意 `case.js` 是**合法场景名**——它不以 `.case.js` 结尾。这一题就是我当时写错的地方：
只判断了「以 .js 结尾」，结果把 Node 侧文件也当成场景丢进渲染进程执行，
报出来的错和真正的原因毫无关系。

示例：`isScenarioFile('today.js') → true`，`isScenarioFile('today.case.js') → false`，
`isScenarioFile('.js') → false`。提示：先验证输入类型和文件名形状，再按排除规则判断；不要把 `case.js` 误当成配对文件。

```js
isScenarioFile('today.js')                  // true
isScenarioFile('navigation-and-settings.js') // true
isScenarioFile('case.js')                   // true —— 它不以 .case.js 结尾
isScenarioFile('_prelude.js')               // false —— 前置代码
isScenarioFile('today.case.js')             // false —— Node 侧配对文件
isScenarioFile('.js')                       // false —— 只有扩展名
isScenarioFile('README.md')                 // false
isScenarioFile('today.JS')                  // false —— 扩展名大小写敏感
isScenarioFile(42)                          // false
```

**顺序很重要：** 先排除 `_` 开头和 `.case.js` 结尾，再接受 `.js`。反过来的话
`today.case.js` 会先被当作 `.js` 收下。

### 8. `extractDriveResult(stdout)`

从 Electron 的一大堆输出里，把场景结果取出来。

- 找到第一行以 `DOTODO_DRIVE_RESULT ` 开头的内容，把后面那段按 JSON 解析；
- 没有这一行、后面是空、或不是合法 JSON → 返回 `null`；
- **`[]` 是合法结果**：一个断言都没写的场景返回空数组，不能和"没收到结果"混为一谈；
- 有多个标记时只取第一条；
- 输入不是字符串 → `null`。

```js
extractDriveResult('noise\nDOTODO_DRIVE_RESULT [{"name":"a","passed":true}]\nready');
// [{ name: 'a', passed: true }]

extractDriveResult('DOTODO_DRIVE_RESULT {"scenarios":2}')  // { scenarios: 2 }
extractDriveResult('DOTODO_DRIVE_RESULT []')               // [] —— 合法结果
extractDriveResult('DOTODO_DRIVE_RESULT ')                 // null —— 后面什么都没有
extractDriveResult('DOTODO_DRIVE_RESULT {not json}')       // null
extractDriveResult('nothing here')                         // null
```

标记必须出现在**行首**、后面跟一个空格。

### 9. `summarizeScenarios(results)`

`results` 是 `[{ name, checks: [{ passed }], error? }]`。返回：

```js
{ scenarios, assertions, passed, failed, broken, exitCode }
```

- `broken` 数的是 `error` 非空的场景（连跑都没跑起来）；
- `exitCode` 在 `failed > 0` **或** `broken > 0` 时为 `1`，否则为 `0`；
- 非数组输入按空数组处理。

「没有断言但有错误」这种情况最容易写错：断言数是 0，但绝不能报通过。

```js
summarizeScenarios([
  { name: 'a', checks: [{ passed: true }, { passed: true }] },
  { name: 'b', checks: [{ passed: true }, { passed: false }] },
  { name: 'c', checks: [], error: '跑不起来' }
]);
// { scenarios: 3, assertions: 4, passed: 3, failed: 1, broken: 1, exitCode: 1 }

summarizeScenarios([{ name: 'a', checks: [{ passed: true }] }]);
// { scenarios: 1, assertions: 1, passed: 1, failed: 0, broken: 0, exitCode: 0 }
```

对照第二个例子：`scenarios` 数是**场景**个数，`assertions` 数是**断言**个数，两者不是一回事。
空输入返回 `{ scenarios: 0, assertions: 0, passed: 0, failed: 0, broken: 0, exitCode: 0 }`。

### 10. `withinDeadline(startedAt, now, timeoutMs)`

等待循环的判定：还没到点就继续等。

- `now - startedAt <= timeoutMs` 为 `true`；
- **正好到点仍算在窗口内**（和实际循环里 `if (now > deadline) return false` 一致）；
- 三个参数里任何一个不是有限数字（`NaN`、`Infinity`、字符串、缺失）→ `false`。

```js
withinDeadline(1000, 1500, 600)   // true —— 才过了 500ms
withinDeadline(1000, 1600, 600)   // true —— 正好到点，仍算在窗口内
withinDeadline(1000, 1601, 600)   // false —— 超了 1ms
withinDeadline(1000, Number.NaN, 600) // false
withinDeadline(1000, 1500, '600')     // false —— 字符串不算
```

### 11. `fitsInside(inner, outer, tolerance = 0)`

判断一个矩形是否完全落在另一个矩形里。四个边都是 `top` / `left` / `right` / `bottom` 数字。

- 贴边算在里面（`>=` 和 `<=`，不是严格不等号）；
- 容差用来吸收亚像素误差：超出的距离不超过 `tolerance` 仍然算通过；
- `inner` / `outer` 缺字段，或某个边不是有限数字 → `false`；
- `tolerance` 不是有限数字 → `false`。

这题守的是一个真实缺陷：提示条曾经压在页面标题上面。几何断言 `提示条.bottom <= 标题.top`
比"看起来没问题"可靠得多。

```js
const outer = { top: 0, left: 0, right: 100, bottom: 100 };

fitsInside({ top: 10, left: 10, right: 90, bottom: 90 }, outer)        // true
fitsInside({ top: 0, left: 0, right: 100, bottom: 100 }, outer)        // true —— 贴边也算
fitsInside({ top: 10, left: 10, right: 101, bottom: 90 }, outer)       // false —— 右边超了
fitsInside({ top: 10, left: 10, right: 101, bottom: 90 }, outer, 1)    // true —— 容差吸收
fitsInside({ top: 10, left: 10 }, outer)                               // false —— 缺字段
fitsInside({ top: 'a', left: 0, right: 1, bottom: 1 }, outer)          // false
```

### 12. `diffFileNames(before, after)`

比较两个目录的文件名列表，返回：

```js
{ added: [...], removed: [...], kept: [...] }
```

- 用集合语义：**重复名字只算一次**（恢复文件可能被保留不止一份）；
- 三个数组都按字典序排序，保证输出确定；
- 任一参数不是数组时按空数组处理。

用途是检查"应用有没有在数据目录里留下该留的东西"——比如损坏恢复之后，
`state.json` 变了、多出一个 `recovery-primary-*.json`，而备份不见了。

## 本题不要求处理的情况

判分测试只检查上面写明的行为。下面这些没有覆盖，不必为它们设计规则：

- `countByExtension`：路径里带目录（`'../v1.2/README'`）、末尾是点（`'a.'`）、空字符串
- `formatBytes`：小于 1KB 但带小数（如 `1023.6`）时是四舍五入还是截断
- `isScenarioFile`：`.hidden.js` 这类以点开头的隐藏文件
- `diffFileNames` 的"字典序"用 `sort()`（UTF-16 码元序）还是 `localeCompare`
- `summarizeScenarios` 里 `error` 为 `0` / `false` 时算不算"有错误"
- `buildSmokeEnvironment` 的 `baseEnv` 是数组；`userDataDirectory` 首尾带空白
- `fitsInside` 的 `tolerance` 是负数
- `chooseRecoverySource` 收到表外的 `status` 值

## 代码阅读题

打开产品仓库 `F:\杂\转开发\DoTodo` 中的 `tools/verify-electron.ps1` 和 `src/infrastructure/json-state-store.js`，回答。两条路径均已在产品仓库核实存在；请以实际代码为准，不要只凭题干猜测。

1. `verify-electron.ps1` 里为什么把体积分成「打包目录合计 / 分类占比 / app.asar / 安装器」四个数字分别打印，而不是报一个总数？
2. 空闲内存那一步以前靠「检测到已有 DoTodo 进程就跳过」来决定要不要测，而检测方式有缺陷，于是它长期报告"通过"却什么都没测。现在改用一次性数据目录加进程树 ID。为什么**跳过**比**失败**更危险？
3. `JsonStateStore.save()` 里为什么先把当前主文件复制成备份，再写新的主文件？反过来写会怎样？
4. `#preserveCorruptFile` 失败时为什么要把 `this.writable` 置为 `false`，而不是抛异常就完事？
5. `#writeJsonAtomically` 用「写临时文件 → rename」而不是直接写目标文件，防的是哪种故障？

## 复盘问题

1. 单元测试、集成测试、冒烟测试、人工验收，各自能证明什么、不能证明什么？
2. 为什么冒烟测试必须使用隔离的用户数据目录？如果直接跑真实目录，最坏会发生什么？
3. 什么样的验证结果算「通过」？只看退出码够不够？
4. 「文件损坏了」和「文件损坏了，原文件已保留在 `C:\...`」对用户的实际差别是什么？
5. 如果打包目录从 480 MB 变成 700 MB，你会先看哪几个分类的数字？
6. 交互场景的断言为什么必须「等条件成立」而不是「等固定的毫秒数」？后者在快机器和慢机器上各会出什么问题？
7. `verify` 钩子是在应用退出**之后**跑的，它看到的是最终状态。如果场景中途改了数据，断言要注意什么？（提示：我在这上面连错三次。）
8. 几何断言（`提示条.bottom <= 标题.top`）比"我看了一眼没问题"可靠在哪里？它不能替代什么？
9. 场景文件本身也需要静态守卫（必须以 `return results;` 结尾、不能 `require`）。为什么值得为"测试代码"再写测试？
10. 一个场景跑完会留一张截图。这在断言失败时有什么用？为什么断言全绿时它仍然有价值？
