# 练习 08：手写仓库分类与构建产物的判断逻辑

## 目标

第 8 课要回答的问题是「仓库里这些文件，哪些是产品、哪些是课程、哪些是产物」。
这件事看着像体力活，其实全是判断：产物名怎么拼、体积涨了还是跌了、某个路径属于哪一类。

你要写的 6 个函数就是这些判断。它们不碰文件系统，可以在 Node 里穷举。

## 使用方法

打开 `starter.js`，把 6 个占位函数实现完，然后运行：

```powershell
node exercises/electron/08-build-and-release/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。

## 题目

### 1. `expandArtifactName(pattern, values)`

electron-builder 用 `${name}` 占位符拼产物文件名。实现同样的替换。

```js
expandArtifactName('DoTodo-Setup-${version}-${arch}.${ext}', { version: '1.0.0', arch: 'x64', ext: 'exe' })
// → 'DoTodo-Setup-1.0.0-x64.exe'
```

- 同一个占位符出现多次要**全部**替换；
- `values` 里没有的占位符**原样保留**（保留 `${unknown}`，不要替换成空字符串——那会拼出一个看起来正常、其实缺了版本号的文件名）；
- `values` 不是对象（`undefined` / `null`）时，返回原 `pattern`；
- `pattern` 不是字符串时返回 `''`。

### 2. `flattenTargets(config)`

`package.json` 里 `build.win.target` 可能是对象，也可能是数组：

```js
{ target: 'nsis', arch: ['x64'] }
[{ target: 'dmg', arch: ['x64', 'arm64'] }, { target: 'zip', arch: ['arm64'] }]
```

统一展开成 `[{ target, arch }]`，每个架构一项，顺序按配置书写顺序：

```js
flattenTargets([{ target: 'dmg', arch: ['x64', 'arm64'] }])
// → [{ target: 'dmg', arch: 'x64' }, { target: 'dmg', arch: 'arm64' }]
```

- `arch` 缺失或为空数组时，`arch` 取 `null`（表示"当前架构"）；
- 没有 `target` 的条目直接跳过；
- `undefined` / `null` 返回 `[]`。

### 3. `compareSizes(baseline, current)`

比较两次体积测量：

```js
{ deltaBytes, deltaPercent, verdict }
```

- `deltaBytes = current - baseline`；
- `deltaPercent` 是变化量相对基准的百分比，**保留一位小数**（`33.3`、`-0.1`）；
- `verdict` 取值 `'smaller'` / `'same'` / `'larger'`；
- `baseline` 为 `0` 时无法算百分比，`deltaPercent` 取 `null`；
- 任何一个不是有限数字（含负数）时，返回 `{ deltaBytes: 0, deltaPercent: 0, verdict: 'unknown' }`。

`compareSizes(3, 4)` 的百分比是 `33.3` 而不是 `33.333...`。用 `Math.round(x * 10) / 10`，
不要用 `toFixed`（那返回的是字符串）。

### 4. `sortArtifactsBySize(artifacts)`

按体积从大到小排序，**返回新数组，不修改输入**。

- 输入是 `[{ name, size }]`；
- `size` 缺失或不是有限数字时当作 `0`；
- 空数组或非数组返回 `[]`。

先想想 `sort` 是就地修改还是返回新数组——这决定了你要不要先复制。

### 5. `classifyTrackedFile(relativePath)`

把仓库里的路径归到一类。规则按**从上到下**匹配，先命中的先算：

| 路径特征 | 结果 |
| --- | --- |
| `node_modules/`、`release/`、`dist/`、`.worktrees/` 开头 | `'generated'` |
| `exercises/` 开头 | `'course'` |
| `docs/learning/` 开头 | `'course'` |
| `src/` 开头 | `'source'` |
| `test/` 开头 | `'test'` |
| `build/`、`assets/`、`tools/`、`.github/` 开头 | `'packaging'` |
| 正好是 `package.json` 或 `package-lock.json` | `'packaging'` |
| `docs/` 开头（不含 `docs/learning/`） | `'docs'` |
| 正好是 `README.md`、`LICENSE`、`CONTEXT.md`、`.gitignore` | `'docs'` |
| 其他 | `'unknown'` |

- Windows 反斜杠要当成 `/` 处理（`'src\\renderer\\app.js'` → `'source'`）；
- 空字符串、`undefined`、非字符串返回 `'unknown'`。

**注意 `docs/learning/` 必须排在 `docs/` 前面。** 这是本组题里唯一一个"顺序会改变结果"的地方，
判断逻辑写成一串 `if/else if` 时特别容易搞错。

### 6. `summarizeReleasePlan(planned, produced)`

发布计划 vs 实际产物：

```js
summarizeReleasePlan(
  ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-x64.dmg', 'DoTodo-1.0.0-arm64.dmg'],
  ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-arm64.dmg']
)
// → {
//     built: ['DoTodo-Setup-1.0.0-x64.exe', 'DoTodo-1.0.0-arm64.dmg'],
//     missing: ['DoTodo-1.0.0-x64.dmg'],
//     unexpected: []
//   }
```

- `built`：计划里有、实际也产出了的，**按计划的顺序**；
- `missing`：计划里有、实际没产出的，按计划的顺序；
- `unexpected`：实际产出了、但不在计划里的，**按实际产出的顺序**；
- 任一参数不是数组时按空数组处理。

`unexpected` 这一项存在的意义是：它可能意味着配置写错了，也可能意味着多构建了不该发布的东西。
两种都值得看一眼。

## 代码阅读题

打开 `package.json` 和 `tools/verify-electron.ps1`，回答：

1. `build.files` 为什么要写成白名单（`src/**/*`、`assets/**/*`、`package.json`），而不是反过来写 `!test`、`!docs` 这类排除规则？
2. `build.asar: true` 把应用代码打进 `app.asar`。为什么打包目录里有 360 MB，而 `app.asar` 只有几十 KB？
3. `verify-electron.ps1` 里 `npm run pack` 和 `npm run dist:win` 分别产出什么？为什么验证脚本用前者？
4. `.gitignore` 里为什么同时忽略 `node_modules/`、`release/` 和 `.worktrees/`？如果只忽略 `node_modules/` 会怎样？
5. `tools/` 目录被归为 `packaging` 而不是 `source`。这个分类对吗？如果不对，应该怎么分？

## 复盘问题

1. 一个仓库要同时对「只想用这个工具的人」和「想学 Electron 的人」自解释。README 各要写什么？
2. 为什么课程文档放在 `docs/learning/`、习题放在 `exercises/`，而不是都塞进 `docs/`？
3. 旧的实现分支（WPF）已经确定不走，为什么本文没有直接删掉它，而是留到用户确认之后？
4. 「生成的产物」和「必须提交的文件」之间的界线怎么划？`.gitignore` 上写错一边分别会有什么后果？
5. 如果别人 clone 这个仓库跑 `npm test`，他需要哪些东西才能跑起来？README 里写清楚了吗？
