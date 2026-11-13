# Windows 桌面固定栏与任务组件：资料笔记

研究范围：可直接点击、输入的任务组件和固定栏；以下是官方文档证据与待验证项，不是实现方案。访问日期：2026-11-13。

## 现有产品

- **Notion**：官方 [Mobile widgets](https://www.notion.com/help/mobile-widgets) 明确描述 iOS 14+ 和 Android 主屏幕组件，包含页面、收藏、最近访问及 AI 快捷入口，主要用于打开页面或数据库；这不是 Windows 桌面原生组件或直接勾选任务的证据。未查到 Notion 官方 Windows 桌面小组件支持，不能据此断言绝对不存在；第三方 Notion 桌面组件属于非官方方案，能力、账号授权和维护需逐个核实。
- **Rainmeter**：[Arranging Skins](https://docs.rainmeter.net/manual/arranging-skins/) 说明皮肤可拖动、记住位置、跨显示器放置，并有 On Desktop 等层级；吸附针对屏幕边缘和其他皮肤，文档没有承诺避让桌面图标。[鼠标动作](https://docs.rainmeter.net/manual/mouse-actions/) 和 [InputText](https://docs.rainmeter.net/manual/plugins/inputtext/) 分别提供点击动作与文本输入能力，但具体任务操作和同步取决于皮肤实现；不能推断所有皮肤支持完整键盘交互。自由摆放也不等于系统为其保留工作区。
- **Wallpaper Engine**：[Web Wallpaper](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html) 支持 HTML/CSS/JS 壁纸项目；[SceneScript 输入](https://docs.wallpaperengine.io/en/scene/scenescript/reference/class/IInput.html) 明确提供鼠标位置和左键状态。它们是壁纸/桌面背景模式，不等价于可任意移动的独立窗口或固定栏；上述资料未证明 Web 壁纸键盘焦点、输入法、图标覆盖时点击路由或图标自动避让，须实测，不能将鼠标输入等同于完整任务编辑体验。

## Windows 边界

- Microsoft [Application Desktop Toolbars](https://learn.microsoft.com/en-us/windows/win32/shell/application-desktop-toolbars) 定义 AppBar 必须锚定屏幕边缘，注册后系统阻止其他应用使用其占据的区域；通过 `ABM_QUERYPOS`、`ABM_SETPOS` 协调任务栏和其他 AppBar，并响应位置变化，退出前 `ABM_REMOVE`。这是固定栏及工作区影响，不是任意位置桌面小组件；不能由工作区保留推断桌面图标一定自动避让。
- 普通独立窗口可以实现自己的交互和自由位置，但不自动享有 AppBar 的工作区协调；壁纸层及 Explorer 内部窗口挂载不能据此视为微软保证的稳定公开契约。Explorer 重启、显示器/DPI 变化、显示桌面、全屏、锁屏和任务栏重建均需单独验证；当前未找到足够一手证据证明某种桌面嵌入方式的重建保证，也未验证 AppBar 在 Explorer 重启后自动恢复，需设计恢复并测试。

## 待验证

1. Windows 10/11、多屏及 DPI 下，图标自动排列、拖拽、缩放与组件位置冲突的实际行为。
2. 桌面层与壁纸模式在图标覆盖、鼠标穿透、键盘焦点和输入法下是否满足勾选及编辑任务。
3. Explorer 重启后窗口、层级、AppBar 注册与工作区恢复，以及全屏和显示桌面的表现；避免把观察结果当成公开 API 保证。
