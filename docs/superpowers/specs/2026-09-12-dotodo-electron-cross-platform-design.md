# DoTodo Electron 跨平台版设计

## 目标

DoTodo 是一张常驻桌面的每日清单。产品目标是用一套 Electron + 原生 JavaScript + HTML/CSS 代码覆盖 Windows 与 macOS，并让源码本身成为一套可逐步学习的 Electron 示例。

本轮先在 Windows 完成可运行开发版，保持原先已经确认的每日清单规则；用户验收后再制作 Windows NSIS `.exe` 安装器。macOS 的 `.app`、`.dmg`、签名与公证在 Windows 版稳定后完成，不在 Windows 上伪造未经验证的 macOS 产物。

## 学习目标

完成项目后，读者应能解释并实践：

1. Electron 主进程、渲染进程与 Preload 的职责；
2. `BrowserWindow` 如何承载网页界面并接入原生窗口；
3. `contextIsolation`、沙箱与 IPC 白名单为什么必要；
4. 浏览器 UI 如何调用托盘、全局快捷键、开机启动和文件系统；
5. 纯 JavaScript 业务逻辑如何与 Electron 解耦并测试；
6. 同一份源码如何分别生成 Windows `.exe` 和 macOS `.app`/`.dmg`；
7. Electron 体积主要来自 Chromium 与 Node.js，而不是业务代码；
8. 哪些功能可以跨平台复用，哪些必须通过平台适配器实现。

每个开发阶段同时产出一篇 `docs/learning/electron/` 教学文档，包含概念、代码入口、运行命令、验证方法、常见错误和一个可自行完成的练习。

## 技术选择

- Electron 44，沿用仓库锁定版本；升级依赖不是本轮目标。
- 原生 JavaScript，不引入 React、Vue、TypeScript 或前端打包器。
- HTML/CSS 负责渲染，不使用第三方 UI 组件库。
- Node 内置测试运行器执行领域与持久化测试。
- `electron-builder` 生成 Windows NSIS 安装器和 macOS DMG/ZIP。
- CommonJS 用于主进程、Preload、领域与存储模块；渲染进程只通过 `window.dotodo` 使用公开能力。

选择原生 JavaScript是为了让 Electron 自身的边界清晰可见。是否加入 React 不会显著改变 Chromium 运行时和安装包体积。

## 进程与模块边界

### 主进程

主进程拥有操作系统权限，并负责：

- Electron 应用生命周期与单实例；
- 创建、恢复和管理 `BrowserWindow`；
- 托盘、全局快捷键、关闭到托盘与开机启动；
- 窗口普通、置顶和桌面层级；
- 调用领域引擎并持久化状态；
- JSON 导入、导出和打开数据目录；
- 只注册明确命名的 IPC handler。

主进程不创建 DOM，不拼接界面 HTML，也不信任渲染进程传来的数据。

### Preload

Preload 是权限边界，只通过 `contextBridge` 暴露按用途命名的方法，例如：

```js
window.dotodo.getSnapshot()
window.dotodo.addTask(text)
window.dotodo.toggleTask(taskId)
window.dotodo.setWindowMode(mode)
```

它不暴露 `ipcRenderer`、`fs`、`shell` 或任意频道调用能力。`nodeIntegration` 保持关闭，`contextIsolation` 和沙箱保持开启。

### 渲染进程

渲染进程只负责：

- 将状态快照渲染为 Today、History 与 Settings；
- 收集键盘、鼠标和拖放输入；
- 调用 Preload API；
- 根据主进程返回的新快照刷新界面；
- 展示非阻塞错误、撤销条和空状态。

渲染进程不直接读写 JSON，不直接修改可信状态，也不调用 Node API。

### 领域层

纯 JavaScript 领域模块封装：

- 添加、编辑、完成、删除与手动排序；
- 六秒撤销令牌；
- 本地午夜归档；
- 系统日期回拨保护；
- 历史只读规则；
- 历史任务终身最多延续一次；
- 延续引用的双向一致性；
- 输入长度和状态合法性。

领域模块不导入 Electron、DOM 或文件系统，因此可以用 `node --test` 快速验证。

### 持久化层

`JsonStateStore` 负责：

- schema 校验与规范化；
- 临时文件 + 原子替换写入；
- 主文件和备份文件恢复；
- 损坏文件保留与恢复路径提示；
- 导入前完整校验；
- 导出当前快照。

Windows 数据目录使用 Electron `app.getPath('userData')`；macOS 使用同一 API，由 Electron 映射到系统应用支持目录。

## 产品行为

### Today

- 新任务只能加入当天，新任务放在底部。
- 支持添加、勾选、双击编辑、删除、六秒撤销和拖放排序。
- 完成项保持原位置，不自动沉底。
- 显示完成数、总数和细进度条。
- 本地日期前进后，旧 Today 成为只读历史；未完成项不自动带到次日。
- 本地日期回拨时不重新打开已归档日期，并显示警告。

### History

- 按日期倒序展示每天最终状态。
- 历史文字、完成状态和顺序只读。
- 历史任务可以删除和撤销。
- 未完成且从未延续的历史任务可以复制到 Today 一次。
- 延续后保留来源和目标元数据；删除目标也不会重新开放延续按钮。

### 桌面壳层

- 无边框、可移动、可调整大小，记住窗口位置与尺寸。
- 关闭默认隐藏到托盘；托盘提供显示、隐藏、退出。
- `CommandOrControl+Shift+Space` 全局显示或隐藏窗口。
- 普通和置顶模式使用 Electron 官方 `BrowserWindow` API。
- 桌面模式保留统一的 `WindowMode` 接口。Windows 的底层 Z-order 行为放在独立平台适配器中；macOS 使用可公开验证的最接近系统行为。平台无法保证完全一致时，界面必须说明差异，不能静默伪装。
- 开机启动使用 Electron `app.setLoginItemSettings`。macOS 未签名/未公证开发包可能无法可靠启用，正式发布前单独验证。

## 视觉设计

采用深色玻璃悬浮卡片：

- `BrowserWindow` 保持透明，无原生标题栏；
- 背景层使用深蓝黑半透明色，内容层保持完全不透明；
- 透明度滑块只改变背景层 alpha，不调用整窗 `setOpacity`；
- 主强调色为青蓝，完成色为薄荷绿，危险操作为柔和珊瑚红；
- 细边框、克制阴影、适度圆角，不加入图片或字体资源；
- 标题栏左侧为应用名和日期，右侧依次为层级、设置、最小化、关闭；
- 设置使用右上角弹出的紧凑面板，关闭按钮始终在面板右上角；
- Today/History 使用底部轻量标签，保持单窗口动线；
- 动效限制在 200ms 左右，并尊重 `prefers-reduced-motion`。

Windows 11 可选系统背景材质，但不能作为基本透明效果的依赖；Windows 10 和 macOS 仍需保持可读。

## 数据流

```text
用户操作
  → Renderer 调用 window.dotodo
  → Preload 参数收窄
  → IPC handler 再次校验
  → DailyTodoEngine 产生新状态
  → JsonStateStore 原子保存
  → 主进程返回只读快照
  → Renderer 重绘
```

任何保存失败都保留当前内存状态、显示错误并允许重试。导入失败不替换当前状态。

## 测试与验收

- 领域单元测试覆盖每日规则、延续、撤销和日期边界。
- 存储单元测试覆盖序列化、原子保存、备份、损坏恢复和无效导入。
- IPC 测试覆盖频道白名单、参数校验和错误返回。
- DOM 测试优先测试纯渲染函数和事件到命令的映射，不用测试浏览器实现本身。
- Electron smoke 启动窗口、加载状态并自动退出。
- Windows 人工验收覆盖透明窗口、托盘、热键、开机启动、多显示器和 DPI。
- macOS 人工验收覆盖交通灯/无边框行为、菜单栏、Dock、登录项、Intel/Apple Silicon、签名和公证。

## 体积原则

- 不把 `node_modules`、测试、源码映射、旧构建和教学素材放入 ASAR。
- `electron-builder.files` 使用精确白名单。
- 不引入前端框架、数据库、图片包或重复运行时。
- 分别报告安装器下载体积、安装后体积、项目构建目录总量，不能混为一个数字。
- Electron 自带 Chromium 与 Node.js，因此不会达到 WPF 的 0.1 MiB；目标是消除可控冗余，而不是宣传不真实的极小体积。

## 仓库清理策略

清理分两阶段进行：

1. Electron 功能移植期间保留 WPF 工作树作为行为对照，避免丢失已验证规则。
2. Electron 通过自动测试和用户验收后：
   - 删除本地 WPF 工作树；
   - 删除旧 `release/`、临时 spike 和生成缓存；
   - 主分支只保留 Electron 源码、测试、当前设计/教学文档、图标和打包配置；
   - 旧 WPF 分支是否永久删除，在 GitHub 发布前单独确认，避免不可逆丢失历史。

## 明确不做

- 不加入 React、Vue、TypeScript、Redux 或数据库；
- 不加入账号、云同步、提醒、标签、优先级、项目或未来日程；
- 不在 Windows 上声称已完成 macOS 运行验收；
- 不在用户验收前制作正式安装包或上传 GitHub；
- 不为缩小数字删除 Electron 运行所需的 Chromium/Node 文件。

## 实施顺序

1. 重构纯 JavaScript 领域模型和测试；
2. 重构安全存储和恢复；
3. 建立主进程、Preload 与 IPC 边界；
4. 实现深色玻璃 Today 界面；
5. 实现 History、Settings、撤销和拖放；
6. 接入托盘、全局快捷键、窗口模式和开机启动；
7. 完成 Windows 自动验证与人工验收入口；
8. 清理旧实现与构建产物；
9. 用户确认后制作 Windows 安装器；
10. 在 macOS 或 CI macOS runner 上完成 DMG、签名与公证验证。
