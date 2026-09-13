# 练习 07：手写验证与恢复的判断逻辑

## 目标

第 7 课做的是「怎么知道自己做对了」：体积统计、损坏恢复、冒烟测试的隔离目录、可重复的验证脚本。

这些东西的价值全在于**判断的准确性**——统计错一个数字、恢复时挑错文件、冒烟测试写到真实数据目录，都会让人得出错误结论。你要写的 6 个函数就是这些判断本身，它们不碰文件系统，所以可以在 Node 里穷举。

## 使用方法

打开 `starter.js`，把 6 个占位函数实现完，然后运行：

```powershell
node exercises/electron/07-testing/starter.test.js
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

### 2. `summarizeVerification(steps)`

`steps` 是 `[{ name, status }]`，`status` 取值 `'passed'` / `'failed'` / `'skipped'`。返回：

```js
{ total, passed, failed, skipped, ok, firstFailure }
```

- `ok` 表示 `failed === 0`；
- `firstFailure` 是**第一个**失败步骤的 `name`，没有失败时为 `null`；
- 空数组、`null`、`undefined` 都返回全零且 `ok: true`。

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

## 代码阅读题

打开 `tools/verify-electron.ps1` 和 `src/infrastructure/json-state-store.js`，回答：

1. `verify-electron.ps1` 里为什么把体积分成「打包目录合计 / 分类占比 / app.asar / 安装器」四个数字分别打印，而不是报一个总数？
2. 测量空闲内存前为什么要先检查 `Get-Process -Name DoTodo`？如果用户已经开着 DoTodo，直接跑会出什么问题？
3. `JsonStateStore.save()` 里为什么先把当前主文件复制成备份，再写新的主文件？反过来写会怎样？
4. `#preserveCorruptFile` 失败时为什么要把 `this.writable` 置为 `false`，而不是抛异常就完事？
5. `#writeJsonAtomically` 用「写临时文件 → rename」而不是直接写目标文件，防的是哪种故障？

## 复盘问题

1. 单元测试、集成测试、冒烟测试、人工验收，各自能证明什么、不能证明什么？
2. 为什么冒烟测试必须使用隔离的用户数据目录？如果直接跑真实目录，最坏会发生什么？
3. 什么样的验证结果算「通过」？只看退出码够不够？
4. 「文件损坏了」和「文件损坏了，原文件已保留在 `C:\...`」对用户的实际差别是什么？
5. 如果打包目录从 480 MB 变成 700 MB，你会先看哪几个分类的数字？
