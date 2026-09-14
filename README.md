# DoTodo

一个常驻桌面的每日待办清单。透明悬浮卡片，深色玻璃质感，数据只存在本机，不需要账号也不用联网。

用 Electron + 原生 JavaScript 写，同时**整套源码就是一套 Electron 课程**。

## 它是什么

- **每天一张清单**。新任务只能加进今天；过了午夜，昨天整天的清单变成只读历史。
- **历史不会被改写**。历史任务的文字、完成状态和顺序都冻结，只能删除或「延续到今天」。
- **延续只发生一次**。一个历史任务终身最多被延续一次，删掉延续出来的新任务也不会重新开放按钮。
- **后悔药有六秒**。删除后底部弹出撤销条，六秒内可以恢复，超时自动失效。
- **桌面常驻**。无边框、可拖动缩放、中性灰玻璃（固定透明度，不提供会调坏可读性的滑杆）、支持置顶 / 桌面层级、托盘、全局快捷键、开机启动。
- **数据在本机**。单个 JSON 文件，原子写入 + 备份轮转 + 损坏恢复，可以导出和导入。

## 想直接用

需要 Node.js 22.12 或更新版本。

```powershell
git clone <仓库地址>
cd DoTodo
npm install
npm start
```

打包安装程序（Windows）：

```powershell
npm run dist:win      # 生成 release/DoTodo-Setup-<版本>-x64.exe
```

安装程序未签名，Windows 会提示"未知发布者"，选择"仍要运行"即可。

**如果打包时卡在下载或报 `The server aborted pending request`**：electron-builder 要从 GitHub 拉
Electron 二进制和 NSIS，国内网络经常中断。设置镜像即可（实测有效）：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist:win
```

### 数据在哪

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\dotodo\state.json` |
| macOS | `~/Library/Application Support/dotodo/state.json` |

> 目录名是小写的 `dotodo`，因为 Electron 用 `package.json` 的 `name` 决定它
> （顶层没有 `productName`）。**不要**为了好看去改这个名字：那会把数据目录挪走，
> 老用户的清单看起来就像丢了。想知道确切路径，让应用自己回答：
>
> ```powershell
> npm run paths
> ```

同目录下还有：

- `state.backup.json` —— 上一次保存的完好副本；
- `state.tmp.json` —— 写入过程中的临时文件，正常情况下不会留下；
- `recovery-primary-*.json` / `recovery-backup-*.json` —— 检测到损坏时保留下来的原始文件。

**备份就是复制 `state.json`。** 设置面板里也能直接导出、导入，以及一键打开数据目录。

### 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl/⌘ + Shift + Space` | 全局显示 / 隐藏窗口 |
| `Ctrl/⌘ + N` | 聚焦到输入框并回到今天 |
| `Enter` | 添加任务 |
| `Space` | 切换当前行的完成状态 |
| `F2` / 双击文字 | 编辑 |
| `Delete` | 删除当前行 |
| `Alt + ↑/↓` | 调整当前行顺序（等价于拖拽） |
| `Esc` | 取消编辑、关闭设置面板 |

## 想学 Electron

**从这个文件开始：**[`docs/learning/electron/README.md`](docs/learning/electron/README.md)

那是课程总索引。九课按顺序讲完这个应用从空目录到安装包的全过程：

| 课 | 主题 |
| --- | --- |
| 01 | 不依赖 Electron 的纯 JavaScript 领域层 |
| 02 | Node 文件系统、原子写入与损坏恢复 |
| 03 | Main / Preload / Renderer 与安全 IPC 边界 |
| 04 | 透明窗口、深色玻璃与 DOM 投影 |
| 05 | 状态驱动的交互：历史、撤销、拖拽、设置 |
| 06 | 托盘、全局快捷键、窗口层级、开机启动 |
| 07 | 导入导出、数据恢复与验证工作流 |
| 08 | 仓库整理、构建配置与课程索引 |
| 09 | 打包、签名与跨平台发布 |

每一课都配了手写习题（[`exercises/electron/`](exercises/electron/)），8 组 50 道题，全部用 `node:test` 自动判分：

```powershell
node exercises/electron/04-renderer/starter.test.js
```

习题**不在** `npm test` 范围内，做不做都不影响应用运行。

## 架构

```text
src/
  main.js                    主进程组合根：生命周期、启动顺序、退出清理
  preload.js                 contextBridge 白名单，页面唯一能看到的接口

  domain/                    纯 JavaScript，不知道 Electron 存在
    state-schema.js          状态格式、默认值、完整校验
    daily-todo-engine.js     每日规则、历史只读、延续、六秒撤销

  infrastructure/
    json-state-store.js      原子写入、备份轮转、损坏恢复、导入导出

  electron/                  与 Electron API 打交道的那一层
    ipc.js                   固定频道表 + 参数校验 + 持久化
    window-controller.js     BrowserWindow 创建、安全选项、尺寸防抖
    shell-controller.js      托盘、全局快捷键、窗口层级、开机启动
    local-time.js            带本地时区偏移的时间戳

  renderer/                  只画界面，不碰 Node
    index.html               语义化结构
    view-model.js            纯投影函数（快照 → 视图数据）
    app.js                   DOM 渲染、事件、命令调用
    styles.css               深色玻璃视觉系统

tools/
  run-smoke.js               真实 Electron 冒烟测试（隔离数据目录）
  make-tray-icon.js          从代码生成托盘图标位图
  verify-electron.ps1        Windows 自动验证

assets/                      运行时需要的位图（托盘图标）
build/                       只用于构建的资源（应用图标 SVG）
```

数据流是单向的：

```text
用户操作 → Renderer 调用 window.dotodo
         → Preload 收窄参数
         → IPC handler 再次校验
         → DailyTodoEngine 产生新状态
         → JsonStateStore 原子保存
         → 返回只读快照
         → Renderer 重绘
```

**界面永远不会自己改状态。** 屏幕上的一切都是主进程确认过的快照的函数。

## 命令

```powershell
npm start            # 开发运行
npm test             # 全部测试（169 条断言 / 14 个文件）
npm run smoke        # 真实 Electron 冒烟测试，使用隔离的临时数据目录
npm run ui-check     # 在真实渲染进程里重放交互（8 个场景 / 187 条断言），每个场景留一张截图
npm run icons        # 重新生成托盘图标
npm run shot         # 把界面渲染成 PNG（可指定底色和页面），用于检查视觉效果
npm run paths        # 打印应用实际使用的数据目录与状态文件路径
npm run pack         # 打包到 release/win-unpacked（不出安装器）
npm run verify:win   # 一次跑完：测试 + 冒烟 + 交互 + 打包 + 体积分类 + 空闲内存
npm run dist:win     # Windows NSIS 安装包
npm run dist:mac     # macOS dmg + zip（必须在 macOS 上执行）
```

## 自动化到什么程度

| 层 | 覆盖 | 命令 |
| --- | --- | --- |
| 单元 / 集成 | 领域规则、存储与恢复、IPC 校验、投影函数 | `npm test` |
| 静态约束 | 选择器对得上、渲染层不碰 Node、界面没混进不该有的元素 | `npm test` |
| 冒烟 | 真实 Electron 里 Preload、IPC、DOM 真的连通 | `npm run smoke` |
| **交互场景** | **在真实渲染进程里点击、按键，断言 DOM 与磁盘结果；含跨日归档、时钟回拨、损坏恢复** | `npm run ui-check` |
| 打包 | 产物能装、体积分类、asar 内容不含测试与文档 | `npm run verify:win` |
| 人工 | 托盘、DPI、多显示器、真实安装升级、手感 | [验收清单](docs/testing/electron-windows-manual-checklist.md) |

## 平台状态

| 平台 | 状态 |
| --- | --- |
| Windows | 已实现，自动验证可跑；**人工验收清单见 [`docs/testing/electron-windows-manual-checklist.md`](docs/testing/electron-windows-manual-checklist.md)** |
| macOS | 代码路径已写好（`CommandOrControl`、登录项、`desktop` 层级的差异说明），但**尚未在 macOS 上构建和验证**。签名、公证和 `dist:mac` 待第 9 课 |

关于 Electron 应用的体积：安装后约 360 MB，其中业务代码只有二十几 KB，其余是 Chromium 与 Node.js 运行时。
详细的分类实测数字和「想变小该怎么做」写在[附录](docs/learning/electron/appendix-desktop-stack-and-packaging.md)里。

## License

[MIT](LICENSE)
