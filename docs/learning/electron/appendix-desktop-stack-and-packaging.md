# 附录：桌面技术栈、体积与发布格式

> 这一篇不是第 8 课的一部分，而是把项目早期「选哪个技术栈」的调研结论留下来。
> 它回答的是**为什么这个项目用 Electron，以及为此付出了什么**。原始调研基于 2026-09-11
> 的一手资料（框架官方文档、操作系统厂商文档、产品方公开说明），WPF 那条实现路线已经被
> 放弃了，相关内容只保留结论，不再保留操作步骤。

## 一、「悬浮在桌面上」不是一个技术

用户看到的「悬浮待办」可能是完全不同的实现：

- 普通顶层窗口 + 置顶标志；
- 无边框 + 分层窗口（layered window）做整窗透明；
- 系统托盘驻留 + 全局快捷键召回；
- 真正嵌进 Windows 桌面层（`WorkerW` / `Progman` 父子窗口技巧）；
- 或者只是桌面小组件 / 皮肤。

**只靠视觉效果无法判断是哪一种。** 大多数公开产品提供的是前三种的组合，不会去用第四种——
那是未公开、随系统更新就可能失效的做法。

对 DoTodo 的含义：把需求定义成「普通窗口 + 可切换置顶 + 透明背景 + 托盘 + 全局快捷键 + 位置记忆」，
用官方 API 全部能实现，而且行为可以解释、可以测试。第 6 课里 `desktop` 模式返回一段
「这是近似实现」的说明，正是这条结论的直接后果：**做不到就说做不到，不要用视觉相似去暗示等价。**

## 二、候选技术栈对比

| 技术 | UI 与语言 | 运行时 | 发布模型与体积来源 | 透明 / 置顶 / 托盘 |
| --- | --- | --- | --- | --- |
| WinUI 3 | XAML + C#/C++，仅 Windows | Windows App SDK + Win32 HWND | framework-dependent 或 self-contained；可 MSIX 或非打包 | `AppWindow` 管窗口；整窗透明度与托盘通常要落到 Win32 |
| WPF | XAML + C#，仅 Windows | .NET Desktop + WPF | framework-dependent 较小但目标机需 .NET；self-contained 携带 .NET | `Window.Opacity` / `AllowsTransparency` / `Topmost` 原生支持；托盘用 `NotifyIcon` |
| Avalonia | AXAML + C#/F#，三平台 | .NET + Avalonia + Skia | 来自 .NET、Avalonia、Skia 与原生库；支持 Native AOT 但需处理反射/trim 告警 | 三平台都支持 `Topmost`；Windows 完整支持 `TrayIcon` |
| Tauri 2 | HTML/CSS/JS + Rust | Rust core + 系统 WebView（Windows 用 WebView2） | 默认不捆绑浏览器；极简示例可小于 600 KB，但嵌入 WebView2 离线安装器会多 127–180 MB | 官方 API 支持 always-on-top、透明窗口、tray icon |
| **Electron** | HTML/CSS/JS + Node.js | **每个应用捆绑 Chromium、V8、Node.js**，多进程 | **固定运行时体积最大**；再加应用代码、原生模块与安装器 | `BrowserWindow` 直接支持透明、`setOpacity`、`setAlwaysOnTop`；官方 `Tray` |

### 这个项目为什么仍然选 Electron

- 用户的学习目标是「Electron 技术栈 + 一个真实应用」；
- 前端是 HTML/CSS/JS，没有新语言要学；
- 透明窗口、置顶、托盘、全局快捷键全部有官方 API，不需要任何原生扩展；
- Windows 与 macOS 共用同一份源码。

**代价要说清楚**：Electron 把完整浏览器运行时捆进每个应用。这不是"漏删了几个图片"造成的，
压不下去；能压的只有业务侧冗余（见下一节）。

### 如果将来要重新做选型

不要凭印象选。用同一组验收场景各做一个最小 spike，每个 spike 都记录**四个数字**：

1. 下载的安装器大小；
2. 安装后磁盘占用；
3. 冷启动时间与内存；
4. 空闲驻留内存。

**不能把「压缩后的 installer」和「解压后的 app folder」混在一起比。** 这是选型里最常见的错误比较。

## 三、体积到底花在哪里

`npm run verify:win` 会把打包目录按类别拆开报，本机实测（Electron 44，旧版产物）：

```text
可执行文件 exe                234.7 MB   63.9%  (1 个)
语言包 locales               48.3 MB   13.1%  (55 个)
动态库 dll                   39.6 MB   10.8%  (6 个)
其他                        19.5 MB    5.3%  (2 个)
Chromium 资源 pak           13.8 MB    3.7%  (3 个)
V8 / ICU 数据               11.4 MB    3.1%  (3 个)
应用代码 resources           132.7 KB    0.0%  (2 个)
配置 json                     106 B    0.0%  (1 个)
----------------------------------------------
打包目录合计                   367.5 MB  (73 个文件)
app.asar                  27.7 KB    0.0%  ← 应用自身代码
```

结论很直接：**业务代码占不到千分之一。** 想让安装包变小，唯一有效的办法是换运行时模型
（比如 Tauri），而不是继续优化 JS。

### 真正值得审计的冗余

- 是否把 devDependencies、source map、测试、示例文档打进了分发物；
- 是否有用不到的 locale（`electron-builder` 可以只保留需要的语言）；
- 是否重复打包了图标、字体、图片；
- 是否无意合入了用不到的 native module；
- 是否把多个 CPU 架构的文件塞进了单架构包。

## 四、EXE / MSI / MSIX / DMG 与「编译」的关系

一条完整的流水线其实是五个不同的阶段：

```text
源码（JS/CSS/HTML）
  → 编译/转译（生成 bundle、IL、机器码）
  → 发布（收集程序、运行时、DLL、资源、配置）
  → 打包（形成 app folder / app bundle / asar）
  → 安装器或分发容器（setup.exe / MSI / MSIX / DMG）
  → 签名、公证、发布、更新
```

一个 npm script 可以把它串起来，所以看起来像"一次编译出了安装包"，但概念上仍然是不同工作。
分清这五步之后，很多困惑会消失：

| 格式 | 它是什么 | 常见误解 |
| --- | --- | --- |
| `.exe` | Windows 可执行文件，**角色由内容决定** | 以为「是 EXE」就等于很小 / 免安装 / 原生编译 |
| `.msi` | Windows Installer 数据库，装的是已发布好的应用 | 以为它替代了编译器 |
| `.msix` | 带 package identity 的 Windows 应用包，**安装前必须签名** | 以为可以像免安装包一样直接跑 |
| `.dmg` | macOS 磁盘映像，通常装一个已签名 `.app` | 以为 DMG 和 EXE 是同一层的东西；写成 `.dwg`（那是 AutoCAD 图纸格式） |

同一个 Windows 程序可以同时有：主程序 `DoTodo.exe`、安装器 `DoTodo-Setup-1.0.0-x64.exe`，
以及将来的 `.msix`。它们是同一份源码的不同分发容器，不是三种编译结果。

## 五、发布前的体积审计清单

无论最终用哪个技术栈，这份清单都适用：

- 分开报告 **installer 下载体积 / 安装后体积 / 打包目录体积**，不混为一个数字；
- 枚举包里最大的文件，而不是只看总数；
- 确认是否捆绑了完整 runtime / WebView / browser；
- 排除 devDependencies、测试、source map、示例、文档、未使用的 locale；
- 检查图标、字体、图片是否重复或未压缩；
- 按 x64 / ARM64 分别构建，不把多架构文件无意合入单架构包；
- 做完 trimming / AOT 之后，回归测试全部交互、序列化、托盘、启动项与升级；
- 最终发布物必须签名，并在**干净的 Windows 虚拟机**上测试安装、升级、卸载和数据保留。

第 9 课会按这份清单实际走一遍 Windows 安装包和 macOS 发布路径。
