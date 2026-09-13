# 练习 06：手写原生壳层的判断逻辑

## 目标

第 6 课接入了托盘、全局快捷键、窗口层级和开机启动。这些功能都在主进程里，不能靠启动窗口来测。生产的实现把「和系统打交道」与「决定做什么」混在 `src/electron/shell-controller.js` 里，只把后者留在可测的边界上。

你要写的就是那部分「决定做什么」：它不调用任何 Electron API，输入是普通对象，输出也是普通对象。

## 使用方法

打开 `starter.js`，把 6 个占位函数实现完，然后运行：

```powershell
node exercises/electron/06-native-shell/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。

## 题目

### 1. `planTrayMenu(settings)`

把设置投影成一份菜单计划（每项都是纯数据，不含回调函数），顺序固定为：

```js
[
  { id: 'show',           label: '显示 DoTodo',       type: 'normal',   checked: false },
  { id: 'hide',           label: '隐藏 DoTodo',       type: 'normal',   checked: false },
  { id: 'topmost',        label: '窗口置顶',          type: 'checkbox', checked: ? },
  { id: 'closeToTray',    label: '关闭时隐藏到托盘',  type: 'checkbox', checked: ? },
  { id: 'launchAtLogin',  label: '开机启动',          type: 'checkbox', checked: ? },
  { id: 'quit',           label: '退出 DoTodo',       type: 'normal',   checked: false }
]
```

- 置顶的勾选只在 `windowMode === 'topmost'` 时为 `true`；`'desktop'` 不算置顶；
- 另外两个开关直接取设置的布尔含义，缺失时为 `false`；
- `settings` 为 `undefined` 时仍然返回 6 项，全部不勾。

为什么把菜单做成「纯数据 + 一个渲染函数」？因为这样菜单结构就能被测试，而不是只能靠肉眼点一次。

### 2. `shouldHideOnClose({ closeToTray, isQuitting, hasTray })`

关闭窗口时到底该隐藏还是该真的关掉。返回布尔值。

- 三个条件都满足才隐藏：开了关闭到托盘、不是在退出过程中、托盘确实建起来了；
- **托盘不可用时必须返回 `false`**：否则窗口藏起来之后用户再也找不回来；
- 字段缺失按 `false` 处理。

### 3. `reconcileLaunchAtLogin(requested, effective)`

写入开机启动之后要用系统的读回值确认。返回：

```js
{ ok, effective, rollback }
```

- `effective` 是布尔值且等于 `requested` → `ok: true`、`rollback: false`；
- `effective` 是布尔值但不等于 `requested` → `ok: false`、`rollback: true`，`effective` 用读回值；
- `effective` 不是布尔值（`undefined`、`null`）→ 说明系统不支持读回，此时信任请求：`ok: true`、`effective` 取 `requested`。

最后一条很关键：**「读不到」不等于「失败」**，两者要分开处理，否则在不支持读回的平台上会把正常设置误判成失败。

### 4. `describeWindowMode(platform, mode)`

平台能力探测。返回 `{ mode, exact, note }`，或在平台不支持时返回 `null`。

- `normal` 和 `topmost` 在任何平台都是官方 API，`exact: true`、`note: null`；
- `desktop` 在 `win32` 和 `darwin` 上是近似实现，`exact: false`，`note` 要能区分平台（Windows 的说明里出现「近似」，macOS 的说明里出现「macOS」）；
- 其他平台上的 `desktop`、以及任何未知模式，返回 `null`。

要点：不要为了让 API 好看而假装三端一致。

### 5. `formatShortcut(accelerator, platform)`

把 Electron 的加速键文本转成用户看得懂的样子。

```js
formatShortcut('CommandOrControl+Shift+Space', 'win32')  → 'Ctrl + Shift + Space'
formatShortcut('CommandOrControl+Shift+Space', 'darwin') → '⌘ + Shift + Space'
formatShortcut('F2', 'win32')                            → 'F2'
```

- 以 `+` 拆开，逐个去空白，再用 `' + '` 拼回去；
- 只有 `CommandOrControl` 需要按平台替换（darwin → `⌘`，其他 → `Ctrl`）；
- 空字符串、`null`、`undefined` 返回 `''`。

### 6. `summarizeShellBoot(result)`

把启动结果压成一句状态：

```js
{ tray: 'ready' | 'unavailable', shortcut: 'ready' | 'conflict', messages: [...] }
```

- `tray` 由 `trayCreated` 决定；
- `shortcut` 由 `shortcut.registered` 决定，缺失时算 `conflict`；
- `messages` 是 `warnings` 的副本，并过滤掉所有假值（`''`、`null`、`undefined`）；
- `warnings` 不是数组时 `messages` 为空数组。

## 代码阅读题

打开 `src/electron/shell-controller.js`，回答：

1. `attachCloseHandler` 里为什么先判断 `if (!tray) return;` 再判断 `closeToTray`？把这两行调换会怎样？
2. `dispose()` 里为什么要执行 `tray = null;`？不置空会发生什么？
3. `refreshMenu()` 里的 `checked` 为什么读 `getSettings()`，而不是控制器自己记一份状态？
4. 托盘菜单的设置变更走 `onCommand` 意图，而显示 / 隐藏直接调用窗口方法。这个划分的依据是什么？
5. `registerShortcut` 在 `register` 返回 `true` 之后为什么还要问一次 `isRegistered`？

## 复盘问题

1. `ready`、`before-quit`、`will-quit`、`window-all-closed` 分别在什么时候触发？注册和注销资源的正确位置分别是哪个？
2. 为什么 `closeToTray` 一旦生效，`window-all-closed` 就基本不会触发了？
3. 全局快捷键和窗口内的键盘快捷键有什么区别？各自该在哪里注册？
4. 为什么「开机启动写入成功」不等于「开机启动已生效」？哪些平台最容易出现这种情况？
5. 托盘图标为什么不能用 SVG？`assets/tray.png` 和 `assets/tray@2x.png` 的分工是什么？
6. 如果某个功能在 macOS 上确实做不到，界面应该怎么处理才算诚实？
