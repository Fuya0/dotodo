# Windows 桌面待办：窗口行为、技术栈与发布格式调研

> 调研日期：2026-09-11。本文只采用产品厂商、框架维护者和操作系统厂商的一手资料。对于闭源产品，公开帮助文档通常只能证明“用户看到的行为”，不能证明其内部是怎样挂接 Windows 桌面窗口层级的；这类情况会明确标为“未公开”。

## 先给结论

1. “悬浮在桌面”不是单一技术。常见产品公开提供的通常是普通应用窗口、置顶窗口、系统托盘、Windows 小组件（Widgets）或桌面皮肤中的一种或组合。仅凭视觉效果，不能判断它把窗口真正嵌入了 Windows 的桌面层。
2. 如果 DoTodo 首期只把 Windows 做好，需求本质是一个正常的顶层窗口，加上可切换置顶、整窗透明度、托盘驻留、位置记忆和全局召回。Windows 官方 Win32 API 已直接支持置顶、分层窗口透明度和通知区域图标，无需依赖“WorkerW/Progman 桌面嵌入”之类未公开、脆弱的技巧。[分层窗口](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)、[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)、[通知区域图标](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar)
3. 初版约 300 MB 并不意味着业务代码有 300 MB；如果它采用 Electron，主要固定成本来自随每个应用一起分发的 Chromium、V8、Node.js、Electron 二进制和平台资源。Electron 官方明确说明它把这些运行时直接捆绑进应用；打包器还会把应用代码与 Electron binary 合并后再生成安装分发物。[Why Electron](https://www.electronjs.org/docs/latest/why-electron)、[Electron 打包教程](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
4. Windows 优先且强调原生系统行为时，WPF 是成熟、直接、教学成本较低的选择；若仍把未来 Windows/macOS 共用一套 UI 视为硬目标，Avalonia 或 Tauri 更合适。Tauri 通过系统 WebView 避免随应用捆绑完整浏览器，通常比 Electron 小；Avalonia 则使用 C#/.NET 和自绘 UI。最终体积必须用同一功能原型、同一架构和同一安装口径实测，不能只比较框架宣传的最小示例。
5. `.exe`、`.msi`/`.msix`、`.dmg` 不是“同一份源码的几种编译方式”。编译先把源码变成可运行程序；发布再收集运行时和依赖；打包/安装器再把发布产物做成适合某个操作系统安装或分发的容器。同一 Windows 程序既可以有主程序 `.exe`，又可以另做一个安装器 `.exe`、`.msi` 或 `.msix`。
6. 用户先前所说的 `dwg` 很可能是 `dmg`。`.dwg` 是 AutoCAD 图纸格式，不是 macOS 安装包；Autodesk 官方称其为 AutoCAD 原生 drawing 格式。[Autodesk DWG 说明](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Customization/files/GUID-D029509F-A2A0-4A7E-BDD5-FE95E7235C5C.htm)

## 一、市面产品在 Windows 上究竟是“常驻”还是“模拟”

### 判断原则

- “进程常驻”是应用关闭窗口后仍在后台运行，例如保留通知区域图标、同步或响应快捷键。
- “窗口置顶”是正常顶层窗口处于 topmost Z-order；它仍是普通窗口，不等于嵌入桌面。
- “Windows 小组件”由 Windows Widgets board/小组件宿主展示，不等于应用自己的窗口常驻桌面。
- “桌面皮肤”是由一个桌面定制程序绘制和管理的皮肤。它也不自动证明采用了某个未公开的桌面窗口句柄技巧。

| 产品 | 官方可证实的 Windows 行为 | 能否断言“真正嵌入桌面层” |
|---|---|---|
| Microsoft To Do | 官方可确认 Windows 桌面应用、应用内快捷键，以及 Windows 10 时代将“我的一天”固定到 Start 的 Live Tile | 不能；Live Tile 是开始菜单磁贴，不是桌面常驻窗口，官方资料未说明托盘、始终置顶或 Windows 11 桌面 Widget |
| TickTick | 官方 Windows 页明确有全局快速添加、把任务固定在屏幕且“始终可见”的 Desktop Sticky Notes、Desktop Widgets 和专注 mini window | 不能；官方描述了产品行为，没有公开其窗口类、Z-order 或 Explorer 桌面层实现 |
| Todoist | 官方明确支持多窗口，并可对窗口启用 `Float on top`；Windows 快捷键为 `Ctrl+F11`；故障排查文档明确使用 system tray 里的 Todoist 菜单 | 可断言它有普通窗口的可选置顶和托盘行为；不能据此说它嵌入桌面层 |
| Microsoft Sticky Notes | 每张便笺作为 note window 打开/关闭，可恢复位置并固定应用到任务栏；官方明确称目前不能保持在其他应用上方 | 不能；官方证据反而表明它是会被其他应用覆盖的普通便笺窗口 |
| Rainmeter | 官方定义 skin 是桌面上的可移动、动态、可交互 window，并提供 Stay Topmost、Topmost、Normal、Bottom、On Desktop 五种层级、透明度、点击穿透、位置记忆与托盘菜单 | 官方源码可确认它创建 Win32 layered popup window 并用 `SetWindowPos` 管理 Z-order；公开源码未显示把 skin re-parent 到 Progman/WorkerW，准确说是原生窗口 + 层级管理 |

### 分产品证据

#### Microsoft To Do

微软帮助文档可证明 Windows 版 To Do 有应用快捷键；另一篇旧版文档说明可以把“我的一天”固定为 Start Live Tile 并调整磁贴大小。[To Do 快捷键](https://support.microsoft.com/en-us/todo/using-keyboard-shortcuts-in-microsoft-to-do)、[To Do Live Tile](https://support.microsoft.com/en-us/todo/using-live-tile-with-microsoft-to-do)、[设置 Microsoft To Do](https://support.microsoft.com/en-us/todo/set-up-microsoft-to-do)

官方当前资料没有说明 Windows 系统托盘、始终置顶或 Windows 11 桌面 Widget。严谨说法是“未在上述官方资料中提供/说明”，而不是断言产品绝对没有。Live Tile 属于 Start 界面，不是可悬浮在桌面或其他应用上的独立窗口。

#### TickTick

滴答清单 Windows 官方页列出：`Alt+Shift+A` 全局快速添加；Desktop Sticky Notes 可将重要任务固定在屏幕上并保持可见；Desktop Widgets 可直接查看任务和勾选完成；另有专注 mini window。[TickTick Windows 官方页](https://ticktick.com/windows?language=zh_CN)、[TickTick Help Center](https://help.ticktick.com/)

这些证据能证明“用户能得到什么”，不能证明它是 Explorer 桌面子窗口、普通 topmost window，还是另一种 Z-order 方案。闭源产品没有公开实现就不应反推。

#### Todoist

Todoist 官方说明桌面版支持多个窗口，并可对任一窗口启用 `Float on top`，Windows 快捷键为 `Ctrl+F11`。这清楚描述的是一个保持在其他窗口上方的可选置顶窗口。[Todoist multi-windows / Float on top](https://www.todoist.com/help/todoist/features/introduction-to-todoist-multi-windows-on-desktop-H9by8jUOH)

其 Windows/macOS 故障排查要求用户在 system tray 右键 Todoist 图标执行 Quit、Clear app data 或禁用硬件加速，因此可确认桌面版存在托盘图标/菜单路径；官方还提供 Launch at startup 设置。[Todoist 桌面版故障排查](https://www.todoist.com/help/todoist/troubleshooting/troubleshoot-performance-issues-with-the-todoist-desktop-apps-w7j8XNbfu)、[Todoist 开机启动](https://www.todoist.com/help/todoist/features/open-the-todoist-desktop-app-at-startup-rzvJH2F3I)

#### Microsoft Sticky Notes

微软文档将每个便笺描述为可打开/关闭的 note window，并说明应用会尝试在此前位置恢复便笺。最关键的是，官方明确写明 Sticky Notes 当前不能保持在其他应用上方。因此它适合作为“放在桌面、需要时看”的普通窗口例子，不是常驻最上层。[Sticky Notes 入门](https://support.microsoft.com/en-us/windows/apps/stickynotes/get-started-with-sticky-notes)

不要把 OneNote Quick Notes 的 `Always on Top` 混写成 Sticky Notes 的功能；微软把它们作为不同产品能力分别记录。[OneNote Quick Notes](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/create-quick-notes)

#### Rainmeter

Rainmeter 官方文档将 skin 定义为 Windows 桌面上的可移动、动态、可交互 window，并列出 Stay Topmost、Topmost、Normal、Bottom、On Desktop 五种 position 模式；还提供透明度、可拖动、点击穿透和多显示器等设置。[Rainmeter skins](https://github.com/rainmeter/rainmeter-docs/blob/master/source/manual/skins/index.html)、[Arranging Skins](https://github.com/rainmeter/rainmeter-docs/blob/master/source/manual/arranging-skins.html)、[ZPos 与透明度 bangs](https://github.com/rainmeter/rainmeter-docs/blob/master/source/manual/bangs.html)

它是开源产品，因此能进一步核验实现：官方 `Skin.cpp` 使用 `CreateWindowEx` 创建带 `WS_EX_LAYERED | WS_EX_TOOLWINDOW` 的 `WS_POPUP` 窗口，`ChangeZPos` 使用 `SetWindowPos` 调整层级。源码的这条路径没有显示将 skin re-parent 到 Progman/WorkerW。[Rainmeter `Skin.cpp`](https://github.com/rainmeter/rainmeter/blob/master/Library/Skin.cpp)、[官方 UI 字符串（托盘、透明度、On Desktop 等）](https://github.com/rainmeter/rainmeter/blob/master/Language/en.ini)

所以 Rainmeter 的准确归类是“真实 Win32 窗口，通过 Z-order 呈现桌面组件体验”，不是绘进壁纸；同时也没有证据支持“使用 Explorer 私有 WorkerW 嵌入”的说法。

### 对 DoTodo 的含义

首期不必追求“绑定到桌面图标背后的某个内部窗口”。稳定方案是：

- 平时是一个无边框或轻边框的正常窗口；
- 用户可明确切换普通/置顶；
- 关闭时按设置隐藏到通知区域；
- 托盘单击或全局快捷键可召回；
- 透明度作用于窗口视觉，但必须设下限，避免窗口完全不可找回；
- 记住屏幕、位置、大小和置顶状态；显示器断开后把窗口纠正回当前工作区。

Win32 官方文档给出的底层能力足够覆盖这些需求：`SetWindowPos(..., HWND_TOPMOST, ...)` 可保持顶层，layered window 配合 `SetLayeredWindowAttributes` 可设置整窗 alpha，`Shell_NotifyIcon` 可管理通知区域图标。[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)、[Window Features / Layered Windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)、[The Taskbar](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar)

## 二、候选技术栈

### 对比摘要

| 技术 | UI 与主要语言 | 运行时/渲染 | 发布模型与主要体积来源 | 透明/置顶/托盘 |
|---|---|---|---|---|
| WinUI 3 | XAML + C#/C++；仅 Windows | Windows App SDK + Win32 HWND | 可 framework-dependent 或 self-contained；后者携带 Windows App SDK/.NET，明显更大；也可 MSIX 或非打包发布 | AppWindow 管窗口；高级整窗透明度/托盘可落到 HWND/Win32 API |
| WPF | XAML + C#；仅 Windows | .NET Desktop + WPF | framework-dependent 较小但目标机需 .NET；self-contained 携带 .NET；可 single-file、传统安装器或 MSIX | `Window` 原生有 `Opacity`、`AllowsTransparency`、`Topmost`；托盘可用 Windows Forms `NotifyIcon` 或 Win32 |
| Avalonia | AXAML + C#/F#；Windows/macOS/Linux | .NET + Avalonia + Skia；Windows 直接用 Win32 | framework-dependent 或 self-contained；可 single-file、Native AOT/trim；体积来自 .NET、Avalonia、Skia 与原生库 | 官方窗口层支持 Topmost 和透明级别；Windows 完整支持 `TrayIcon` |
| Tauri 2 | HTML/CSS/JS（可不选重型前端框架）+ Rust | Rust core + 操作系统 WebView；Windows 为 WebView2 | Rust 产物、前端资产和所选插件；默认不捆绑浏览器；若离线嵌入 WebView2 则安装器可额外增加约 127–180 MB | 官方 API 支持 always-on-top、透明窗口配置和 tray icon；整窗 opacity 可视需求经 Windows API 补充 |
| Electron | HTML/CSS/JS + Node.js | 每个应用捆绑 Chromium、V8、Node.js；Chromium 式多进程 | 固定运行时体积最大；再加应用、native modules、资源与安装器 | `BrowserWindow` 直接支持透明、整窗 opacity、always-on-top；官方 `Tray` 支持通知区域 |

### 1. WinUI 3 / Windows App SDK

WinUI 3 是微软当前的 Windows 原生 UI 路线。WinUI 窗口最终基于 Win32 `HWND`，`AppWindow` 是顶层 HWND 的高层抽象，并能控制显示、位置、大小、Z-order 和任务切换器可见性。[WinUI 窗口模型](https://learn.microsoft.com/en-us/windows/apps/develop/ui/windowing-overview)、[AppWindow API](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.windowing.appwindow?view=windows-app-sdk-1.8)

发布有两个彼此独立的决策：是否使用 MSIX package identity，以及 Windows App SDK runtime 是 framework-dependent 还是 self-contained。framework-dependent 的运行时需已安装/另行部署；self-contained 把运行时带入应用，会显著增大输出。[Windows 应用打包概览](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)、[非打包 WinUI 3 分发](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)

对于 DoTodo：WinUI 3 能提供最新 Windows 视觉，但部署与窗口边缘行为并不必然比 WPF 简单。官方 `AppWindow` 文档可证明 Z-order 控制，但没有一个与 Electron `setOpacity` 或 WPF `Opacity` 同样直观的跨版本“整窗透明度滑杆”承诺；实现时应把它当作需用 HWND/Win32 验证的项目，而不是先假定完全由 WinUI 属性解决。系统托盘也可直接使用 Win32 `Shell_NotifyIcon`。

### 2. WPF / .NET

WPF 的 `Window` 官方 API直接列出 `AllowsTransparency`、`Opacity`、`Topmost`、`ShowInTaskbar` 等属性，正好覆盖桌面便签类窗口的核心行为。[WPF Window](https://learn.microsoft.com/en-us/dotnet/api/system.windows.window?view=netframework-4.8.1) 通知区域可通过 .NET Windows Forms 的 `NotifyIcon` 组件完成；微软示例证明它能显示图标、菜单、tooltip，并在双击时激活窗口。[NotifyIcon](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon?view=windowsdesktop-7.0)

.NET 发布时：framework-dependent 只带应用和第三方依赖，机器需安装相容 .NET runtime；self-contained 把 .NET runtime 一起带上；single-file 是文件布局选择，不等于不包含运行时，也不等于跨平台，一个 single-file 仍针对特定 OS/CPU。[.NET 发布概览](https://learn.microsoft.com/en-us/dotnet/core/deploying/)、[single-file](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview)

可通过 trimming 删除静态分析认为未使用的代码，但反射、COM 和无法静态分析的依赖可能导致运行时故障，必须处理所有 trim warnings 并做完整回归测试。[.NET trimming](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-self-contained)

对于 DoTodo：如果“本期只做好 Windows”压倒一切，WPF 是风险较低的候选。代价是以后做 macOS 时，UI 层需要另写或迁移到跨平台框架。

### 3. Avalonia

Avalonia 在 Windows 直接使用 Win32，自己通过 Skia 绘制控件；同一 AXAML、view model、业务逻辑可复用于 Windows、macOS 和 Linux。[支持平台](https://docs.avaloniaui.net/docs/supported-platforms)、[跨平台架构](https://docs.avaloniaui.net/docs/fundamentals/cross-platform-architecture)

官方窗口文档确认 Windows/macOS/Linux 均支持 `Topmost`，Windows 支持全部 `TransparencyLevelHint`，Windows 平台也完整支持 `TrayIcon`。[窗口管理](https://docs.avaloniaui.net/docs/app-development/window-management)、[Avalonia Windows 平台](https://docs.avaloniaui.net/docs/platform-specific-guides/windows)

Avalonia 是 .NET 应用，因此同样面对 framework-dependent 与 self-contained 的取舍。它还支持 Native AOT；官方称 Native AOT 可提供自包含、较快启动和配合 trimming 的较小发布尺寸，但动态控件、反射与部分第三方控件需要显式 AOT/trimmer 配置。[Avalonia Native AOT](https://docs.avaloniaui.net/docs/deployment/native-aot)

对于 DoTodo：它比 WPF 更容易保留未来 macOS 路线，但发布物仍需包含 Avalonia/Skia 及可能的 .NET runtime，不能假定天然达到 Tauri 的最小示例体积。

### 4. Tauri 2

Tauri 用 HTML/CSS/JavaScript 渲染 UI，用 Rust core 调用系统能力。它不把 WebView library 放进最终 executable，而是在运行时使用操作系统 WebView；Windows 使用 Edge WebView2，macOS 使用 WKWebView。[Tauri 架构](https://v2.tauri.app/concept/architecture/)、[Tauri 进程模型](https://v2.tauri.app/concept/process-model/)

这解释了它与 Electron 的主要体积差：Tauri 官方称应用无需每次捆绑浏览器引擎，极简应用可小于 600 KB；这是“极简示例”而不是 DoTodo 成品保证值。[What is Tauri](https://v2.tauri.app/start/) Windows 安装器可生成 WiX `.msi` 或 NSIS `-setup.exe`。默认下载 WebView2 bootstrapper，安装器增量约 0 MB；嵌入 bootstrapper 约 1.8 MB，嵌入离线安装器约 127 MB，固定 WebView2 runtime 约 180 MB。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)

官方窗口 API列出 `alwaysOnTop`、`transparent`、`skipTaskbar` 等选项；官方 tray 文档支持创建托盘图标、菜单、点击事件，并示例单击后显示、取消最小化和聚焦主窗口。[Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)、[Tauri System Tray](https://v2.tauri.app/learn/system-tray/)

对于 DoTodo：如果希望继续使用 HTML/CSS 的 UI 开发体验，同时把安装体积从 Electron 大幅压低，Tauri 是最直接的候选。需要接受 Rust 工具链、前端与 core 的 IPC 边界，以及不同 OS WebView 渲染差异。

### 5. Electron

Electron 用 JavaScript、HTML 和 CSS 开发桌面应用。它把 Chromium、V8、Node.js 直接包含在应用 binary 中；最终用户不依赖系统 Node.js。[Electron 首页](https://www.electronjs.org/)、[Electron prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites) 它继承 Chromium 的多进程架构，每个 `BrowserWindow` 的网页在单独 renderer process 中加载。[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)

`BrowserWindow` 官方支持 `setAlwaysOnTop`、`setOpacity`，也能创建透明窗口；`Tray` 类可添加通知区域图标和菜单。[BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[Tray](https://www.electronjs.org/docs/latest/api/tray/) 因而 Electron 在功能实现上并不差，300 MB 的关键问题是“为很小的待办 UI携带了完整浏览器/Node 运行环境”，不是简单地漏删了几个图片。

仍应审计真正的冗余项：是否把 `node_modules` 中 devDependencies、source map、测试、文档、多余 locale、未使用 native modules、重复资源和离线更新文件放进了分发物。Electron 官方也建议审视模块依赖并捆绑应用代码，避免草率引入大量模块。[Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) 但即使清理业务依赖，捆绑 Chromium/Node 的固定成本仍在；要达到“很轻”，换运行时模型通常比继续压 Electron 更有效。

## 三、EXE、MSI、MSIX、DMG 与“编译”的关系

### 一条完整流水线

```text
源码（C#/Rust/JS/HTML/CSS）
  → 编译/转译（生成机器码、IL、JS bundle 等）
  → 发布（收集程序、运行时、DLL、Web 资源、配置）
  → 打包（形成 app folder / app bundle）
  → 安装器或分发容器（setup.exe / MSI / MSIX / DMG）
  → 签名、发布、更新
```

这些阶段可被一个命令自动串联，所以表面上像“一次编译出了安装包”，概念上仍是不同工作。

### EXE

`.exe` 是 Windows 可执行文件扩展名，但文件名本身不能告诉你它扮演什么角色：

- `DoTodo.exe` 可以是安装后每天启动的主程序；
- `DoTodo-Setup.exe` 也可以是一个安装器，它运行后把主程序、DLL、资源写入安装目录并创建快捷方式；
- “single-file EXE”只是把若干发布文件捆成一个入口文件。有的运行时会在启动时解压依赖；微软明确说明 WinUI 3 的相关 single-file 模式会在首次运行时把依赖提取到临时目录。[非打包 WinUI 3 分发](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)

因此，“是 EXE”不等于“很小”“无需安装”“没有其他依赖”或“原生编译”。

### MSI

`.msi` 是 Windows Installer package。微软定义它包含安装数据库、summary stream，以及安装/卸载和安装 UI 所需的数据流，可内嵌或引用 cabinet/source 文件。[Windows Installer installation package](https://learn.microsoft.com/en-us/windows/win32/msi/installation-package)

MSI 的价值是标准化的组件、feature、安装、修复、升级、卸载和企业部署语义。它通常装的是已经编译/发布好的应用，并不是替代编译器。Tauri 例如用 WiX 生成 MSI，也可用 NSIS 生成 setup EXE；两者可安装同一份应用代码。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)

### MSIX

`.msix` 是微软较新的 Windows application package 格式。它给应用 package identity，并提供可预测的安装/卸载、更新以及需要 identity 的 Windows 能力；所有 MSIX 在安装前必须签名。[What is MSIX](https://learn.microsoft.com/en-us/windows/msix/overview)

MSIX 既是包又由 Windows 的部署机制安装，通常比自定义 EXE installer 更受约束，但卸载清晰、Store/企业管理与更新体验更标准。WinUI 3 默认以 package 模式起步；WPF/WinForms 也可以另行封装成 MSIX。[Windows packaging overview](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)

### DMG（不是 DWG）

`.dmg` 是 macOS disk image，即一个磁盘或文件夹内容的压缩副本；用户打开后它会在 Finder 中挂载并显示内容。[Apple Support：disk image](https://support.apple.com/en-gb/guide/mac-help/mchlp1700/mac) 开发者通常把已经编译、签名的 `.app` bundle 放进 DMG，用户再拖到 Applications。Apple 将 DMG、ZIP、`.pkg` 都归为直接分发的容器选择：DMG 适合单个 app/bundle，`.pkg` 更适合多组件、指定安装位置或安装时运行自定义代码。[Apple：Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

DMG 不是 Windows 安装包，也不是把 Windows EXE“改扩展名”得到的。macOS 应用必须针对 macOS 和具体 CPU 架构构建；随后才把 `.app` 放入 DMG、签名并公证。

## 四、对 DoTodo 的阶段建议

### 本期建议的决策顺序

1. 先冻结 Windows 用户行为：普通/置顶切换、透明度、托盘召回、关闭语义、多显示器恢复、开机启动是否可选。
2. 用同一组验收场景做两个最小 spike，而不是凭印象选栈：
   - WPF：验证窗口行为与 Windows 原生体验；
   - Tauri：验证现有 Web UI 迁移、体积、启动时间、内存和透明窗口效果。
3. 每个 spike 都记录四种数字：下载的安装器大小、安装后磁盘占用、冷启动内存、空闲驻留内存。不能拿“压缩 installer”与“解压后 app folder”混比。
4. Windows 首版选择胜者后再完成业务功能。macOS 只保留数据模型与边界，不在本期同时解决签名、公证、DMG 和平台窗口差异。

### 倾向性建议（需要 spike 验证）

- 如果目标是“这期把 Windows 原生行为和学习路径做扎实”：优先 WPF。
- 如果目标是“显著小于 Electron，同时尽量复用 HTML/CSS 并保留 macOS”：优先 Tauri。
- 不建议继续以 Electron 作为“尽量轻量”的默认方案，除非开发速度和成熟生态的优先级高于安装体积与常驻内存。
- 不建议首期使用非公开的桌面句柄嵌入技巧。把它定义成普通窗口 + 可选置顶 + 托盘/快捷键召回，已经能提供稳定、可解释的桌面待办体验。

### 发布前的体积审计清单

- 区分 installer 大小、安装后大小与首次运行后缓存大小；
- 枚举最终包里的最大文件，而不是只看总数；
- 确认是否捆绑完整 runtime/WebView/browser；
- 排除 devDependencies、测试、source maps、示例、文档和未使用 locale；
- 检查图标、字体、图片是否重复或未压缩；
- 按 x64/ARM64 分别构建，不把多架构文件无意合入单架构包；
- 测试 trimming/AOT 后的全部交互、序列化、托盘、启动项和升级；
- 最终发布物签名，并在干净 Windows 虚拟机上测试安装、升级、卸载和数据保留。
