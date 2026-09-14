# DoTodo Electron 课程索引

这套课程不是「Electron 教程 + 一个示例项目」，而是**同一个应用从空目录长到可发布安装包的全过程**。
每一课的源码、测试、文档和习题都能在仓库里找到对应文件，可以随时 `git log` 回看当时的样子。

## 前置要求

- Node.js 22.12 或更新版本；
- 一台能跑图形界面的 Windows 机器（macOS 的验收在第 9 课，且必须在 macOS 上做）；
- 会用编辑器打开一个文件夹、能在终端里执行 `npm` 命令；
- 知道 `function`、对象、数组、`if`/`for` 是什么。**不需要**事先会 Electron，也**不需要**会 React/Vue/TypeScript。

```powershell
cd F:\杂\转开发\DoTodo
npm install
npm start
```

## 怎么学：四步循环

每一课都按同一个节奏走，不要跳步：

```text
① 读     docs/learning/electron/NN-*.md      ← 先看这一课解决什么问题
② 跑     npm test / npm start                ← 亲手看到行为，而不是相信文档
③ 写     exercises/electron/NN-*/starter.js  ← 手写 4–6 个函数，让测试变绿
④ 读码   src/ 里对应的源文件                  ← 最后再看生产代码，对照自己的写法
```

**②和③的顺序不能反。** 先手写再看生产代码，你会在读到的时候不断产生「原来可以这样」的对照；
先看生产代码再手写，多半只是抄一遍。

每课的章节末尾都有「常见错误」和「阅读顺序」，这两节比正文更值得反复看。

## 课程地图

| 课 | 主题 | 预计 | 习题 | 判分命令 |
| --- | --- | --- | --- | --- |
| [01](01-process-model-and-pure-domain.md) | 不依赖 Electron 的纯 JavaScript 领域层 | 45 min | 5 题 | `node exercises/electron/01-process-model/starter.test.js` |
| [02](02-node-files-and-json.md) | Node 文件系统、原子写入与损坏恢复 | 50 min | 5 题 | `node exercises/electron/02-storage/starter.test.js` |
| [03](03-main-preload-renderer.md) | Main / Preload / Renderer 与安全 IPC 边界 | 60 min | 4 题 | `node exercises/electron/03-ipc/starter.test.js` |
| [04](04-browser-window-and-glass-ui.md) | 透明窗口、深色玻璃与 DOM 投影 | 60 min | 6 题 | `node exercises/electron/04-renderer/starter.test.js` |
| [05](05-state-driven-interactions.md) | 状态驱动的交互：历史、撤销、拖拽、设置 | 75 min | 6 题 | `node exercises/electron/05-interactions/starter.test.js` |
| [06](06-native-shell.md) | 托盘、全局快捷键、窗口层级、开机启动 | 70 min | 6 题 | `node exercises/electron/06-native-shell/starter.test.js` |
| [07](07-debug-test-verify.md) | 导入导出、数据恢复与验证工作流 | 45 min | 6 题 | `node exercises/electron/07-testing/starter.test.js` |
| [08](08-build-and-release.md) | 仓库整理、课程索引与构建配置 | 40 min | 6 题 | `node exercises/electron/08-build-and-release/starter.test.js` |
| [09](09-packaging-and-signing.md) | 打包、签名与跨平台发布 | 40 min | — | — |
| [附录](appendix-desktop-stack-and-packaging.md) | 桌面技术栈对比、体积与发布格式 | 20 min | — | — |

「预计」是**认真做完习题**的时间，只读不写大约是一半。

### 第 1 课：纯 JavaScript 领域层

| | |
| --- | --- |
| 解决什么 | 产品规则（每日归档、历史只读、终身一次延续）写在哪里 |
| 源文件 | `src/domain/state-schema.js`、`src/domain/daily-todo-engine.js` |
| 测试 | `test/domain/state-schema.test.js`、`test/domain/daily-todo-engine.test.js`（35 个） |
| JavaScript 要点 | 对象展开、`Object.freeze`、`Set`、`find`/`findIndex`/`some`/`flatMap`、闭包、依赖注入 |
| 关键结论 | 领域层不知道 Electron 存在，所以能用 `node --test` 秒级验证 |

### 第 2 课：持久化

| | |
| --- | --- |
| 解决什么 | 写到一半断电、主文件损坏、导入了坏文件，分别怎么办 |
| 源文件 | `src/infrastructure/json-state-store.js` |
| 测试 | `test/infrastructure/json-state-store.test.js`（11 个） |
| JavaScript 要点 | `fs` 同步 API、`path`、临时文件 + `rename` 原子替换、`fsync`、错误码分支 |
| 关键结论 | 「保存成功」必须是「磁盘上已经有一份完整数据」，而不是「写调用返回了」 |

### 第 3 课：进程边界

| | |
| --- | --- |
| 解决什么 | 网页凭什么能读文件？凭什么不能读任意文件？ |
| 源文件 | `src/electron/ipc.js`、`window-controller.js`、`local-time.js`、`src/main.js`、`src/preload.js` |
| 测试 | `test/electron/*.test.js`（19 个） |
| JavaScript 要点 | Promise / `async`-`await`、`contextBridge`、固定频道表、参数校验、防抖 |
| 关键结论 | 页面是一段不可信代码；它只能请求一组固定命名的操作，不能自己选频道 |

### 第 4 课：界面

| | |
| --- | --- |
| 解决什么 | 怎么画一个透明悬浮卡片，怎么把状态变成 DOM |
| 源文件 | `src/renderer/index.html`、`app.js`、`styles.css`、`view-model.js` |
| 测试 | `test/renderer/view-model.test.js`、`markup.test.js`（36 个） |
| JavaScript 要点 | `map`/`filter`、`Date` 与本地日期、`textContent` vs `innerHTML`、事件委托、游标式 `tabindex` |
| 关键结论 | 界面 = f(快照)；组件不保存第二份真相 |

### 第 5 课：交互

| | |
| --- | --- |
| 解决什么 | 历史页、六秒撤销、拖拽排序、设置面板 |
| 源文件 | 同第 4 课的四个文件（这一课改动最大的是 `app.js`） |
| 测试 | `test/renderer/view-model.test.js`（25 个） |
| JavaScript 要点 | 指针事件、`pointerId`、`[...array].sort()` 的复制语义、CSS 动画重播、悲观更新 |
| 关键结论 | 拖拽是一个状态机；把状态机抽成纯函数就能穷举测试 |

### 第 6 课：原生壳层

| | |
| --- | --- |
| 解决什么 | 托盘、全局快捷键、三种窗口层级、开机启动 |
| 源文件 | `src/electron/shell-controller.js`、`tools/make-tray-icon.js`、`src/main.js` |
| 测试 | `test/electron/shell-controller.test.js`（28 个） |
| JavaScript 要点 | 依赖注入、能力探测（`typeof x === 'function'`）、`try/catch` 包裹原生调用、幂等的 `dispose` |
| 关键结论 | 写入成功 ≠ 已生效；做不到的平台能力要如实说明，不能假装一致 |

### 第 7 课：验证

| | |
| --- | --- |
| 解决什么 | 怎么知道自己做对了；出事后用户怎么找回数据 |
| 源文件 | `tools/verify-electron.ps1`、`tools/run-smoke.js`、`docs/testing/electron-windows-manual-checklist.md` |
| 测试 | `test/electron/ipc.test.js`（20 个） |
| JavaScript 要点 | 错误码分类、字节格式化、reduce 汇总、测试替身、隔离目录 |
| 关键结论 | 单元 / 集成 / 冒烟 / 人工验收各证明一件事；自动化通过 ≠ 可以发布 |

### 第 8 课：仓库与构建

| | |
| --- | --- |
| 解决什么 | 仓库里哪些文件是产品、哪些是课程、哪些是产物 |
| 源文件 | `package.json` 的 `build` 段、`tools/*`、`.gitignore` |
| 测试 | 全部（142 条断言） |
| JavaScript 要点 | `flatMap`、`[...].sort()`、`Set` 做差集、`${}` 模板与正则替换 |
| 关键结论 | 一个仓库要同时对「只想用这个工具的人」和「想学 Electron 的人」自解释 |

### 第 9 课：发布

| | |
| --- | --- |
| 解决什么 | Windows 安装包、macOS `.app`/`.dmg`、签名与公证 |
| 涉及文件 | `package.json` 的 `build` 段、`.github/workflows/release.yml`、`docs/release/*` |
| 清单 | `docs/release/windows-release-checklist.md`、`docs/release/macos-release-checklist.md` |
| 关键结论 | 下载体积 / 安装后体积 / 打包目录体积是三个数字；没验证过的平台不要声称完成 |

**第 9 课的产物目前还没做出来**：正式打包要等人工验收通过，macOS 必须在 macOS 上构建。
两份清单里每一条都是待办，不是已完成记录。

## 全部命令

```powershell
npm start            # 开发运行
npm test             # 全部单元与集成测试（160 条断言）
npm run smoke        # 真实 Electron 冒烟测试（隔离数据目录）
npm run ui-check     # 在真实渲染进程里重放交互并断言 DOM（8 个场景），每个场景留一张截图
npm run icons        # 重新生成托盘图标位图
npm run shot         # 把界面渲染成 PNG，可指定底色与页面
npm run paths        # 打印应用实际使用的数据目录与状态文件路径
npm run pack         # 打包到 release/win-unpacked（不出安装器）
npm run verify:win   # 完整自动验证：测试 + 冒烟 + 交互 + 打包 + 体积分类 + 内存
npm run dist:win     # Windows NSIS 安装包
```

习题不在 `npm test` 范围内，需要单独运行（见上表的判分命令）。

## 关于「我这边看不到界面」

自动化能覆盖逻辑、存储、IPC、投影、构建和打包，但**透明窗口、托盘图标、多显示器、DPI、开机启动**
这些东西只能在真机上人工过一遍：

```powershell
code docs/testing/electron-windows-manual-checklist.md
```

那份清单有 11 组、约 80 项，每一项都写了「怎么造出条件」和「应该看到什么」。
它比这套课程本身更接近真实交付。
