# 第 8 课：仓库、构建配置与课程索引

## 本课完成了什么

功能做完了，测试也有了，但仓库本身还是一团「开发过程中自然堆出来的样子」：早期没走通的技术路线留下的调研文档、课程和习题混在 `docs/` 里、README 还是旧版悬浮待办的说明。这一课把仓库整理成**两种人打开都不会迷路**的样子——想用工具的人，和想学 Electron 的人。

| 改动 | 目的 |
| --- | --- |
| `docs/learning/electron/README.md` | 课程总索引：9 课 + 附录，每课的时长、习题、判分命令 |
| `exercises/electron/README.md` | 习题总索引：8 组 53 题 112 条判分测试 |
| `docs/learning/electron/appendix-desktop-stack-and-packaging.md` | 把早期技术栈调研里**还成立**的结论留下来 |
| 删除三份 WPF 路线文档 | 那条路已经放弃，操作步骤没有保留价值 |
| `README.md` 重写 | 面向使用者和学习者分别给入口 |
| `.gitignore` 补全 | 把所有生成物挡在版本控制之外 |

## 一个文件属于哪一类

整理仓库的第一步不是删东西，是**给每个文件定一个类别**。这个项目用六类：

| 类别 | 判断标准 | 例子 |
| --- | --- | --- |
| source | 会进入 `app.asar`、在用户机器上运行 | `src/**` |
| test | 只在开发时运行，绝不打包 | `test/**` |
| course | 给人读的教学内容 | `docs/learning/**`、`exercises/**` |
| packaging | 构建、图标、CI、依赖清单 | `build/`、`assets/`、`tools/`、`.github/`、`package.json` |
| docs | 面向人或智能体的说明 | `README.md`、`CONTEXT.md`、`LICENSE`、`docs/**` |
| generated | 可以随时重新生成，绝不提交 | `node_modules/`、`release/`、`dist/` |

分类一旦定下来，三个决定就变得机械了：

- **进不进 `app.asar`？** 只有 source 进。`package.json` 的 `build.files` 就是这条规则的实现。
- **提不提交？** 只有 generated 不提。`.gitignore` 就是这条规则的实现。
- **删不删？** 只有「属于已放弃路线」且「结论已经被别处吸收」的才删。

```json
"files": [
  "src/**/*",
  "assets/**/*",
  "package.json"
]
```

这是**白名单**，不是黑名单。写成 `!test`、`!docs` 那种排除式，一旦以后新增了目录（比如 `scripts/`），它会默许进来，直到有人发现安装包莫名多了几十兆。白名单的默认值是"不进"，安全性高得多。

## 360 MB 的目录，27 KB 的代码

第 7 课量过一次，这里再算一笔账：

```text
打包目录合计          367.5 MB   (73 个文件)
├─ 可执行文件 exe     234.7 MB   63.9%
├─ 语言包 locales      48.3 MB   13.1%
├─ 动态库 dll          39.6 MB   10.8%
├─ 其他                19.5 MB    5.3%
├─ Chromium 资源 pak   13.8 MB    3.7%
├─ V8 / ICU 数据       11.4 MB    3.1%
└─ resources/
   ├─ app.asar          27.7 KB  ← 你自己的全部代码
   └─ elevate.exe      ...
```

`app.asar` 就是 `src/**` 打成的归档，二十几 KB。剩下的 367 MB 全是 Electron 的运行时。

理解这一点之后，两个常见误区就没了：

1. **"我的应用太大了，得优化代码。"** 优化不掉。业务代码已经只占千分之一。
2. **"换个更小的框架就好了。"** 这是对的方向，但换的是运行时模型（比如 Tauri 用系统 WebView），不是写法。

`app.asar` 虽然小，仍然值得确认里面没混进测试和课程：

```powershell
npx asar list release/win-unpacked/resources/app.asar
```

## 四种运行方式，各自在干什么

| 命令 | 产物 | 什么时候用 |
| --- | --- | --- |
| `npm start` | 无 | 日常开发。直接跑 `electron .`，读源码目录 |
| `npm run pack` | `release/win-unpacked/` | 验证"打包后会怎样"。不出安装器，最快 |
| `npm run dist:win` | `release/DoTodo-Setup-*.exe` | 出正式安装包。需要 NSIS，慢 |
| `npm run verify:win` | 报告文字 | 一次跑完测试 + 冒烟 + `pack` + 体积分类 + 内存 |

`verify:win` 用 `pack` 而不是 `dist:win`，因为体积分类要分析的是**打包目录**，而不是被压缩过的安装器。安装器体积单独报（本次是 106.3 MB，打包目录 367.5 MB，两个数字差三倍多，混着说就会误导人）。

### electron-builder 配置里值得读的几项

```json
"build": {
  "appId": "app.dotodo.desktop",
  "productName": "DoTodo",
  "asar": true,
  "directories": { "output": "release", "buildResources": "build" },
  "files": ["src/**/*", "assets/**/*", "package.json"],
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }],
    "artifactName": "DoTodo-Setup-${version}-${arch}.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true
  }
}
```

- `appId` 是系统识别应用的标识，**发布后不要改**（改了会被当成另一个应用，用户的"开机启动"等系统级设置会失效）；
- `productName` 决定安装器、快捷方式和可执行文件的名字。**注意它不影响用户数据目录**——数据目录由 `package.json` 顶层的 `name` 决定（顶层没有 `productName` 时 Electron 就用 `name`）。DoTodo 顶层没有 `productName`，所以数据落在 `%APPDATA%\dotodo`，而程序叫 `DoTodo.exe`。这个"不一致"是**故意保留**的：加一个顶层 `productName` 就会把数据目录挪到 `%APPDATA%\DoTodo`，老用户的清单看起来就像丢了；
- `directories.buildResources: build` 里的东西（图标）只用于构建过程，不会进 `app.asar`——这就是为什么图标放 `build/`，而**运行时**要读的托盘 PNG 放 `assets/`；
- `nsis.oneClick: false` + `allowToChangeInstallationDirectory: true` → 安装时让用户选目录。默认的 `oneClick: true` 是"点一下直接装完"，不适合需要选安装位置的用户。

`${version}` 这类占位符来自 `package.json` 的 `version` 字段。`npm version patch` 会自动改它并打 tag 的准备工作，比手改靠谱。

## `.gitignore`：把生成物挡在外面

```gitignore
node_modules/
release/
dist/
*.log

.DS_Store
.idea/
.vscode/

.superpowers/
.worktrees/
```

三类东西：

- **依赖与产物**：`node_modules/`、`release/`、`dist/`。它们可以随时重建，进版本库只会让仓库膨胀几十倍，还会在每次构建时产生巨大的 diff。
- **编辑器与系统**：`.idea/`、`.vscode/`、`.DS_Store`。每个人用的工具不同。
- **本地工作树与工具状态**：`.worktrees/`、`.superpowers/`。这是 Git worktree 和开发工具在本地放东西的地方。

一个容易忽略的点：**`.gitignore` 只影响未被跟踪的文件**。如果某个文件已经被 `git add` 过，之后再写进 `.gitignore` 是没有用的，必须显式 `git rm --cached`。早期不小心提交了 `release/` 的仓库，往往就是这样越滚越大。

## 整理时哪些事不能做

本课做整理，但有三件事**刻意不做**，因为它们需要人来拍板：

**① 不删旧实现的分支和工作树。**
`feature/windows-v1` 那条 WPF 路线已经确定不走，但它的分支里有 8 个提交、一套完整的领域模型和一个测试视图模型。删掉是不可逆的。计划里把这一步明确留到「Electron 通过自动测试**和**用户验收之后」，而且「分支是否永久删除」还要单独确认一次。

**② 不删用户的运行数据。**
`%APPDATA%\dotodo` 是用户真实的清单。任何"清理"都不能碰它。冒烟测试的隔离目录（第 7 课）就是为了保证这一点。

**③ 不把「没验证过」写成「已完成」。**
第 7 课的验证脚本在本机只跑通了能自动化的部分；第 9 课的 macOS 产物在 Windows 上做不出来。这些都要如实写进文档，而不是在 README 里写一句"支持 Windows 和 macOS"。

## 课程与习题的组织

```text
docs/learning/electron/
  README.md                         ← 课程总索引：先读这个
  01-process-model-and-pure-domain.md
  02-node-files-and-json.md
  03-main-preload-renderer.md
  04-browser-window-and-glass-ui.md
  05-state-driven-interactions.md
  06-native-shell.md
  07-debug-test-verify.md
  08-build-and-release.md           ← 本篇
  appendix-desktop-stack-and-packaging.md

exercises/electron/
  README.md                         ← 习题总索引
  01-process-model/{README.md, starter.js, starter.test.js}
  ...
  08-build-and-release/{README.md, starter.js, starter.test.js}
```

分开的理由：`docs/learning/` 是"读"的地方，`exercises/` 是"写"的地方。混在一起会让人以为课程和习题是一份东西，而实际上它们的用法完全不同——课程是顺序读的，习题是反复跑测试的。

每组习题都是同样的三件套：

```text
README.md        题目说明（写清楚边界，不给答案）
starter.js       空壳，每个函数体现在都是 throw
starter.test.js  判分测试，不要改
```

**习题没有放进 `npm test`。** 因为它们是"未完成"状态，全在抛异常。让 `npm test` 变红会破坏"测试全绿 = 应用可用"这个信号。产品测试和练习测试必须是两套命令。

## 重写 README

README 面对两种完全不同的读者，所以开头就要分流：

- **只想用**：下载/安装、数据在哪、怎么备份；
- **想学**：先去 `docs/learning/electron/README.md`。

写 README 的三条实际原则：

1. **命令要能直接复制。** `npm install && npm start` 比"先安装依赖再启动"有用一百倍。
2. **写清数据在哪。** 桌面工具的用户迟早会问"我的数据存哪了、怎么备份"，提前答掉。
3. **不要写没验证过的能力。** "支持 Windows 与 macOS"这种话，在 macOS 产物真的跑起来之前不要写。

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo
npm test
npm run verify:win
```

整理之后应该确认：

1. `git status --short` 干净，没有漏提交的新文件；
2. `git status --ignored --short` 里只有 `node_modules/`、`release/`、`.worktrees/`、`.superpowers/`；
3. `git ls-files` 里没有任何 generated 类别的文件；
4. 从 `docs/learning/electron/README.md` 出发，能点到全部 9 课和每组习题；
5. 随便挑一个习题目录，三件套齐全，`node starter.test.js` 能跑（全红是正常的）。

## 常见错误

- `.gitignore` 写了但文件已经被跟踪过，于是忽略不生效；
- `build.files` 用排除式写法，新增目录悄悄进了安装包；
- 把运行时需要的资源和只用于构建的资源都放进 `build/`（`build/` 不进包）；
- 改 `appId` 或 `productName`，用户被当成新应用，数据目录和系统设置全部失效；
- 把习题测试挂进 `npm test`，让"全绿"这个信号失去意义；
- 清理时顺手删掉还不该删的分支、工作树或用户数据；
- README 里写没有验证过的平台支持；
- 用一个总体积数字描述安装包大小，不区分下载体积、安装后体积和打包目录体积。

## 阅读顺序

1. `docs/learning/electron/README.md`：先看整张地图；
2. `exercises/electron/README.md`：看习题怎么组织、怎么判分；
3. `package.json` 的 `scripts` 和 `build` 两段：命令与打包配置；
4. `.gitignore`：哪些是生成物；
5. `tools/` 三个脚本：冒烟、图标、验证分别做什么；
6. 最后 `git ls-files`，对照本课的六类分类表过一遍。

## 下一课

第 9 课是最后一课：用户验收完成后制作 Windows NSIS 安装包、在 macOS 上构建 `.app`/`.dmg`、签名与公证，以及哪些东西**必须**在真机上验证才能写进发布说明。
