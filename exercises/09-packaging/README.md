# 练习 09：手写安装器与发布产物的判断逻辑

## 目标

第 9 课讲的是「怎么把应用变成别人能装的东西」。这一步看起来是配置活，其实夹着不少
**必须写对、写错了还很难发现**的判断：静默安装的参数怎么拼、注册表里的卸载命令怎么拆、
哪些注册表项算「是本产品」、打包目录里每个文件属于哪一类、哪个版本更新。

你要写的 6 个函数就是这些判断。它们不碰文件系统、不碰注册表、不跑安装器，
所以能在 Node 里穷举——**发布流程里最贵的就是"试一次"**，能提前测的都要提前测。

## 使用方法

打开 `starter.js`，把 6 个占位函数实现完，然后运行：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/09-packaging/starter.test.js
# 只跑某一题（按测试名称筛选）
node --test --test-name-pattern='compareVersions' exercises/09-packaging/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。

## 题目

### 1. `buildSilentInstallArguments(target)`

拼出静默安装 NSIS 安装包的命令行参数。参考产品里的用法：

```powershell
Start-Process -FilePath $installer -ArgumentList "/S /D=$target"
```

返回 `'/S /D=<归一化后的路径>'`。规则：

- `/D=` 后面整行都会被 NSIS 当成安装路径，所以**路径里有空格也不加引号**；
- 只接受**绝对路径**：`C:\...`、`\\server\share\...`、`/tmp/...` 都算；
  `relative\path`、`C:`（只有盘符）、空串、空白串、非字符串都返回 `null`；
- **末尾多余的路径分隔符要去掉**，正反斜杠都算：`C:\a\b\` → `C:\a\b`，
  `C:\a\b\\` → `C:\a\b`，`/tmp/dotodo/` → `/tmp/dotodo`；
- **但盘符根要保留末尾分隔符**：`C:\` 去掉会变成 `C:`，那不是一个位置；
- **中间的分隔符原样保留，不要转换**：`/tmp/dotodo` 就是 `/tmp/dotodo`，
  不能改写成 `\tmp\dotodo`。正斜杠路径在 NSIS 上是合法的，改写反而会错。

> **这里有个顺序坑：先判断"是不是绝对路径"，再谈去掉末尾分隔符。**
>
> 如果先把 `C:` 剥离成 `C:`（补盘符根），它就会变成一条"合法"的绝对路径，
> 而正确答案是 `null`。反过来先做末尾剥离也一样行不通：`C:\` 剥离后成了 `C:`，
> 已经不再是绝对路径了。正确顺序是**先验绝对性 → 再剥离末尾分隔符 → 最后按需补回盘符根**。


```js
buildSilentInstallArguments('C:\\Program Files\\DoTodo')
// → '/S /D=C:\\Program Files\\DoTodo'
buildSilentInstallArguments('relative\\path')
// → null
```

### 2. `parseQuietUninstallCommand(commandLine)`

注册表卸载项里的 `QuietUninstallString` 长这样：

```text
"C:\Users\me\AppData\Local\Temp\probe\Uninstall DoTodo.exe" /currentuser /S
```

拆成 `{ executable, arguments }`：

- `executable` 是去掉引号的路径，`arguments` 是后面的参数（**去掉首尾空白**）；
- 没有参数时 `arguments` 是**空字符串**，不是 `undefined`；
- 命令行**必须以引号开头、并且有配对的结束引号**才接受。理由：路径不加引号时，
  中间的空格到底属于路径还是参数无法判断——与其猜一个，不如返回 `null` 说"我解析不了"；
- 空引号 `""`、非字符串、空串都返回 `null`。

这个函数对应产品里的做法：优先用 `QuietUninstallString` 卸载，因为它正是
Windows「设置 → 应用」会执行的命令。验它，就是在验用户点那个按钮会发生什么。

### 3. `selectUninstallEntry(entries, productName)`

从注册表卸载项列表里挑出属于本产品的那些，**保持输入顺序**返回新数组。

安装器写进去的 `DisplayName` 有两种形态：`productName` 和 `productName 版本号`，例如
`DoTodo` 和 `DoTodo 1.0.0`。所以匹配规则是：

> `DisplayName` 等于 `productName`，**或者**以 `productName` 开头且后面紧跟一个空白字符。

关键在于**后面必须跟空白**，否则：

| `DisplayName` | `DoTodo` 应该匹配吗 |
| --- | --- |
| `DoTodo` | 是 |
| `DoTodo 1.0.0` | 是 |
| `DoTodoHelper 1.0` | **否**（那是另一个产品） |
| `DoTodoX` | **否** |

匹配**区分大小写**（这个值由安装器用 `productName` 原样写入，不是用户输入）。

**把 `productName` 拼进正则时必须转义元字符。** 不转义的话，`Do.Todo` 里的 `.` 会匹配
任意字符，于是 `DoXTodo 1.0` 也会被当成同一套安装——卸载时就会去删别人的东西。

`entries` 不是数组、`productName` 不是非空字符串时返回 `[]`；条目为 `null`、不是对象、
或者 `DisplayName` 不是字符串时跳过。

### 4. `classifyPackagedFile(relativePath)`

把打包目录里的文件归到一类（产品用它打印体积分类表）。规则**按从上到下**匹配：

| 路径特征 | 结果 |
| --- | --- |
| `locales/` 开头 | `'locales'` |
| `resources/` 开头 | `'resources'` |
| 扩展名 `.dll` | `'dll'` |
| 扩展名 `.pak` | `'pak'` |
| 扩展名 `.exe` | `'exe'` |
| 扩展名 `.bin` 或 `.dat` | `'v8-icu'` |
| 扩展名 `.json` | `'config'` |
| 其他 | `'other'` |

- 反斜杠当 `/` 处理（`'resources\\app.asar'` → `'resources'`）；
- 扩展名比较**不区分大小写**（`'DoTodo.EXE'` → `'exe'`）；
- **前缀规则优先于扩展名**：`'locales/en-US.pak'` 是 `'locales'` 而不是 `'pak'`；
  但 `'resources.pak'` 不在 `resources/` 目录里，按扩展名算 `'pak'`；
- 没有扩展名、以 `.` 开头、空串、非字符串 → `'other'`。

```js
classifyPackagedFile('locales/en-US.pak')      // 'locales' —— 前缀优先于扩展名
classifyPackagedFile('resources/app.asar')     // 'resources'
classifyPackagedFile('resources.pak')          // 'pak' —— 不在 resources/ 目录里
classifyPackagedFile('ffmpeg.dll')             // 'dll'
classifyPackagedFile('DoTodo.EXE')             // 'exe' —— 扩展名不区分大小写
classifyPackagedFile('icudtl.DAT')             // 'v8-icu'
classifyPackagedFile('package.json')           // 'config'
classifyPackagedFile('README')                 // 'other'
classifyPackagedFile('')                       // 'other'
```

### 5. `summarizePackagedSize(files)`

把 `[{ relativePath, size }]` 汇总成 `{ total, groups }`：

```js
summarizePackagedSize([
  { relativePath: 'DoTodo.exe', size: 100 },
  { relativePath: 'locales/en-US.pak', size: 50 },
  { relativePath: 'resources/app.asar', size: 30 },
  { relativePath: 'ffmpeg.dll', size: 20 }
])
// → {
//     total: 200,
//     groups: [
//       { category: 'exe',       bytes: 100, count: 1, share: 50 },
//       { category: 'locales',   bytes: 50,  count: 1, share: 25 },
//       { category: 'resources', bytes: 30,  count: 1, share: 15 },
//       { category: 'dll',       bytes: 20,  count: 1, share: 10 }
//     ]
//   }
```

- 分类用上一题的 `classifyPackagedFile`（这题是它的组合）；
- `groups` 按 `bytes` **从大到小**；
- `bytes` 相同时按 **`category` 名称升序**。只按体积排序的话，并列项的顺序会取决于输入
  顺序，同一个输入换个顺序就得到不同输出，测试和界面上都会飘；
- `share` 是占比百分数，**保留一位小数**，用 `Math.round(x * 10) / 10`，不要用 `toFixed`
  （那返回字符串）；
- `size` 缺失、不是有限数字、为负 → 按 `0` 算，但**这一项不能丢**：文件确实在包里，
  `count` 要算上；
- `total` 为 `0` 时所有 `share` 是 `0`；
- 空数组或非数组 → `{ total: 0, groups: [] }`。

示例：`summarizePackagedSize([{ relativePath: 'a.dll', size: 2 }, { relativePath: 'b.pak', size: 1 }])`
→ `{ total: 3, groups: [{ category: 'dll', bytes: 2, count: 1, share: 66.7 }, { category: 'pak', bytes: 1, count: 1, share: 33.3 }] }`。提示：先逐条分类并累计 `bytes`、`count`，最后统一计算占比和排序；不要因无效 `size` 丢掉该文件。

### 6. `compareVersions(left, right)`

比较两个版本号，返回 `1` / `0` / `-1`（`left` 更大 / 相等 / 更小）。

- 按**数字**逐段比较：`'1.10.0'` 比 `'1.9.0'` **大**。字符串比较会得出相反结论，
  而升级判断一旦反过来，用户就会"升级"到旧版本；
- 段数不同时缺的段按 `0` 补：`'1.2'` 与 `'1.2.0'` 相等；
- 参数不是字符串，或者不符合 `数字(.数字)*` 的形状 → 返回 `null`。
  预发布版本（`1.0.0-beta`）不在这里处理，返回 `null` 比给一个错的排序诚实。

示例：`compareVersions('1.10.0', '1.9.0') → 1`，`compareVersions('1.2', '1.2.0') → 0`，
`compareVersions('1.0.0-beta', '1.0.0') → null`。提示：先严格校验完整字符串，再逐段转数字比较，较短版本缺失段按 `0`。

> **坑：`share` 是数字，不是字符串。** 占比正好一半时写 `50`，不是 `'50.0'`
> 也不是 `'50%'`；保留一位小数同样用 `Math.round(x * 10) / 10`，不要 `toFixed`
> —— 它返回的是字符串，`deepEqual` 会判不等。
>
> **坑：`total` 为 0 时 `groups` 必须是 `[]`**，不要返回一个 `share: NaN` 的分组。

## 本题不要求处理的情况

- `buildSilentInstallArguments` 收到首尾带空白的路径（题面不要求 trim）
- 全是分隔符的输入（`/`、`\\\\`）；`C:/` 这种正斜杠盘符根统一成哪种写法
- `parseQuietUninstallCommand` 引号前面有空白、引号内全是空白、引号内不是合法路径
- `classifyPackagedFile` 的 `locales/`、`resources/` 前缀大小写（本题按区分大小写）
- 只有 `locales` 不带斜杠（不算前缀）；`sub/.hidden` 这类目录里以点开头的文件名
- `summarizePackagedSize` 的条目是 `null` / 非对象；`size` 是数字字符串 `'100'`
- `selectUninstallEntry` 里"空白"具体指哪种空白字符（`\\s` 即可）
- `compareVersions` 的前导零（`01.2`）和超大数字段

## 代码阅读题

打开产品仓库 `F:\杂\转开发\DoTodo` 中的 `tools/verify-installer.ps1`、`docs/release/windows-release-checklist.md`，回答。两条路径均已在产品仓库核实存在；请以实际代码为准，不要只凭题干猜测。

1. 脚本在动手安装之前先检查「机器上有没有已存在的 DoTodo 安装」，查到就拒绝运行。
   为什么是**拒绝**，而不是**先帮用户卸载掉再装**？
2. 验证完卸载之后，脚本用「指纹」比较用户数据目录在开始前后是否变化。为什么不能
   简单地用「目录还存在」来证明数据没被删？
3. `DisplayName` 匹配那段的注释里写了"早先这里用等号匹配，一条都匹配不上"。
   为什么这个 bug 比"查询失败"更严重？
4. 脚本里为什么反复强调某些断言"不能依赖退出码"？`Start-Process` 配合输出重定向时，
   `ExitCode` 会是什么状态？
5. 发布清单第 5 节被拆成了「自动部分」和「只有干净机器能验」。划这条线的依据是什么？
   为什么"残留缓存掩盖问题"这一类自动化不了？

## 复盘问题

1. 一个安装包至少要证明哪几件事，才算"能交给别人装"？把你能想到的列出来，
   再对照 `npm run verify:installer` 的九步看漏了什么。
2. 卸载时**删程序**但**保留用户数据**。如果反过来（数据也删）会怎样？
   如果数据也不删、程序也不删，用户会怎么想？
3. 为什么安装器验证要装到一个**临时目录**，而不是默认位置？这样做放弃了哪些验证？
   （提示：想想 `oneClick: false` 和 `allowToChangeInstallationDirectory`）
4. 「验证别人给的东西」和「验证自己写的东西」在心态上有什么不同？
   这一课里哪些检查是在防"上游变了"而不是防"我写错了"？
5. 上游在 Electron 42 去掉了 `postinstall`，导致 `npm ci` 之后跑不起来。
   这类"依赖方悄悄改了行为"的问题，怎么才能尽早发现？
