# 第 3 课：Electron 的 Main、Preload 与 Renderer

## 本课完成了什么

这一阶段第一次搭起完整 Electron 调用链：

```text
Renderer 页面
  → window.dotodo.addTask(text)
  → Preload 固定为 ipcRenderer.invoke('task:add', text)
  → Main 的 ipcMain handler 再次校验参数
  → DailyTodoEngine 改变可信状态
  → JsonStateStore 落盘
  → 返回新快照
  → Renderer 重绘
```

对应入口：

- `src/main.js`：应用组合根和生命周期；
- `src/preload.js`：Renderer 的权限白名单；
- `src/electron/ipc.js`：频道、参数校验和命令持久化；
- `src/electron/window-controller.js`：安全创建与控制窗口；
- `src/electron/local-time.js`：生成带本地偏移的 ISO 时间。

## 三个区域不是三个窗口

### Main 主进程

每个 Electron 应用有一个主进程。它运行 Node.js，能访问文件系统和操作系统 API，并负责 `BrowserWindow`、对话框、登录项和应用生命周期。

DoTodo 的 Main 不拼接任务 HTML。它组合已经写好的领域层、存储层与 Electron 适配器。

### Renderer 渲染进程

每个网页窗口运行在 Renderer 中。这里写的是熟悉的 HTML、CSS、DOM 和事件监听。安全配置下它不能直接 `require('node:fs')`，也不能随便调用系统能力。

### Preload 预加载脚本

Preload 在页面脚本之前运行。它可以使用 Electron 提供的受限 API，并通过 `contextBridge` 给页面暴露少量方法。

它不是普通的“工具文件”，而是一道权限边界。

## 为什么不能暴露整个 `ipcRenderer`

危险写法：

```js
contextBridge.exposeInMainWorld('electron', { ipcRenderer });
```

页面就能自己选择频道和参数。一旦 Renderer 出现 XSS，攻击代码也获得同样能力。

DoTodo 暴露按目的命名的方法：

```js
contextBridge.exposeInMainWorld('dotodo', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('state:get-snapshot'),
  addTask: (text) => ipcRenderer.invoke('task:add', text)
}));
```

Renderer 只能请求“添加任务”，不能请求“调用任意主进程函数”。`Object.freeze` 还避免页面意外替换桥接方法。

## 为什么 Preload 是单文件

DoTodo 的窗口开启 `sandbox: true`。沙箱化 Preload 的 CommonJS 能力受限，不能像普通 Node 模块一样任意加载本地文件。

项目没有引入 webpack、Vite 等打包器，所以 `src/preload.js` 保持自包含，只 `require('electron')`。如果未来引入构建步骤，可以把多个源模块打包为一个 Preload 产物，但最终加载的脚本仍应遵守最小权限。

## IPC 白名单

`src/electron/ipc.js` 的 `CHANNELS` 是固定频道表。注册函数只调用 `ipcMain.handle(channel, handler)`，从不接收 Renderer 传来的方法名。

测试使用一个记录型替身：

```js
const handlers = new Map();
const ipcMain = {
  handle: (channel, handler) => handlers.set(channel, handler),
  removeHandler: (channel) => handlers.delete(channel)
};
```

这样不启动 Electron 也能检查：注册了哪些频道、非法参数有没有进入领域层、成功命令有没有保存、`dispose()` 有没有移除 handler。

## 为什么校验两次

Renderer 表单会先检查输入，Preload 会限制方法形状，但 Main 仍必须把 IPC 参数当作不可信输入。

例如重排只接受：

```js
typeof id === 'string'
Number.isInteger(targetIndex)
targetIndex >= 0
```

Main 的校验负责安全和协议边界；领域层的校验负责产品规则。即使未来换成另一个 Renderer，领域层仍然安全。

注意不要用 `Boolean(value)` 把字符串 `'false'` 变成 `true`。设置频道要求真正的布尔值。

## `invoke/handle` 为什么适合命令

`ipcRenderer.invoke` 返回 Promise，与 `ipcMain.handle` 配对。Renderer 可以等待结果：

```js
const result = await window.dotodo.addTask(text);
```

结果是可序列化的普通对象。成功时带最新快照；保存失败时返回 `{ ok: false, error, snapshot }`。按产品约定，刚完成的内存修改仍保留，页面可以展示错误并允许后续重试。

单向 `send/on` 适合不需要答复的通知，但这里每个用户命令都需要明确成功或失败，所以统一使用 `invoke/handle`。

## BrowserWindow 安全配置

```js
webPreferences: {
  preload: preloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true
}
```

- `nodeIntegration: false`：页面不能直接调用 Node；
- `contextIsolation: true`：Preload 与页面不是同一个 JS 全局环境；
- `sandbox: true`：进一步限制 Renderer/Preload 权限。

窗口还拒绝 `will-navigate` 和 `setWindowOpenHandler` 创建的新页面，避免应用内容把当前窗口带到不可信站点。

窗口设置为 `transparent: true`，但没有调用 `setOpacity`。下一课会用 CSS 只调整玻璃背景 alpha，文字和按钮保持不透明。

## 生命周期与组合根

`app.whenReady()` 后才创建依赖系统能力的对象。启动顺序为：

1. `app.getPath('userData')` 获取当前系统的数据目录；
2. 加载主文件或备份；
3. 创建领域引擎，并用本地时间检查跨日；
4. 创建安全窗口；
5. 注册 IPC；
6. 显式调用窗口控制器的 `load()`；
7. 页面加载完成后显示窗口。

“创建窗口对象”和“加载页面”被刻意拆开。否则 `loadFile()` 已经开始，而 handler 还没注册，Renderer 的首次 `getSnapshot()` 就可能遇到竞态。

`requestSingleInstanceLock()` 防止同一数据文件被两个应用实例同时操作。第二次启动会把已有窗口显示到前台。

每次读取或修改状态前，IPC 还会调用 Main 注入的 `prepareState()`。因此应用跨过午夜而没有重启时，下一条命令会先把旧 Today 归档，再处理新任务；系统日期回拨则继续沿用领域层的保护规则。

启动恢复警告和保存失败不会让窗口消失。Main 把它们保存在运行状态中，Renderer 通过 `getStatus()` 显示提示。`dirty: true` 表示当前内存快照尚未可靠写入磁盘。

## 本地日期为什么不能直接用 `toISOString()`

`new Date().toISOString()` 总是 UTC。北京时间凌晨 00:30 的 UTC 日期仍是前一天，直接截取前 10 位会把任务归错日期。

`formatLocalInstant` 先应用 `getTimezoneOffset()`，再输出：

```text
2026-09-13T00:30:45.123+08:00
```

领域层由此获得明确的本地日历日期，同时保留可比较的时区信息。

## 窗口尺寸防抖

拖动窗口时会产生大量 `move/resize` 事件。控制器等待 250ms，再保存最后一次 `getBounds()`：

```js
clearTimeout(timer);
timer = setTimeout(saveBounds, 250);
```

这叫防抖。测试注入 `schedule/cancelSchedule`，不用真的等待 250ms。

## 真实冒烟测试

```powershell
npm run smoke
```

外层 `tools/run-smoke.js` 先创建隔离用户数据目录，再启动真实 Electron。这样单实例锁、状态文件和 Chromium 配置都不会碰真实开发数据。它从 Renderer 调用 Preload API，验证状态和关键 DOM，然后打印：

```text
DOTODO_SMOKE_READY
```

Main 监听加载失败、Renderer 崩溃和 10 秒超时；外层 runner 还有 15 秒总超时。Electron 完全退出后，runner 删除自己创建的准确临时目录，并要求 READY 与退出码 0 同时成立。Node 单元测试验证逻辑，冒烟测试验证 Electron 运行时能把各层真正接起来。

## 常见错误

- 在 Renderer 开启 `nodeIntegration`，让网页拥有文件权限；
- 把 `ipcRenderer` 或 `fs` 整体暴露给 `window`；
- 用一个 `call(methodName, args)` 万能频道；
- 只在表单中校验，Main 无条件信任 IPC；
- 沙箱化 Preload 仍直接 require 本地源文件；
- 使用 UTC 日期作为用户的“今天”；
- 把整窗 opacity 当成玻璃背景透明度；
- 只看到窗口打开就认为启动成功，没有实际调用桥接 API。

## 阅读顺序

1. `test/electron/preload.test.js`：页面到底能看到什么；
2. `src/preload.js`：方法怎样映射到频道；
3. `test/electron/ipc.test.js`：Main 怎样拒绝非法输入；
4. `src/electron/ipc.js`：命令怎样保存并返回；
5. `test/electron/window-controller.test.js` 和对应实现；
6. 最后读 `src/main.js`，看所有模块如何组装。

下一课会正式替换临时界面，制作参考图方向的深色玻璃 Today 卡片。
