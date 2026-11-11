# 练习 06：手写原生壳层的判断逻辑

## 目标

第 6 课接入了托盘、全局快捷键和开机启动。这些功能都在主进程里，不能靠启动窗口来测。生产的实现把“和系统打交道”与“决定做什么”混在 `src/electron/shell-controller.js` 里，只把后者留在可测的边界上。

你要写的就是那部分“决定做什么”：它不调用任何 Electron API，输入是普通对象，输出也是普通对象。

## 使用方法

打开 `starter.js`，把实际存在的 5 个占位函数实现完，然后在 PowerShell 运行：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/06-native-shell/starter.test.js
```

单题调试可使用名称过滤，例如：

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node --test --test-name-pattern='formatShortcut' exercises/06-native-shell/starter.test.js
```

全部通过即为完成。练习测试不属于产品 `npm test`。只修改 `starter.js` 中的占位函数，不要修改测试来迁就实现。

> 校对说明：当前 `starter.js` 实际导出并要求实现 5 个函数。测试文件的解构列表还写着 `describeWindowMode`，但它没有在测试中调用，`starter.js` 也没有这个函数；这是一处遗留的无效解构，不构成可执行断言。窗口层级功能已经从产品菜单和壳层控制器移除，本练习不应新增它。

## 题目

### 1. `planTrayMenu(settings)`

输入是设置对象或 `undefined`，读取 `closeToTray` 和 `launchAtLogin` 两个字段；返回一个新的、可序列化的数组。每项都是对象，键名、值类型、顺序和字符串必须精确如下：

```js
[
  { id: 'show',        label: '显示在桌面',      type: 'normal',   checked: false },
  { id: 'hide',        label: '从桌面隐藏',      type: 'normal',   checked: false },
  { id: 'closeToTray', label: '关闭时隐藏到托盘', type: 'checkbox', checked: false },
  { id: 'launchAtLogin', label: '开机启动',       type: 'checkbox', checked: false },
  { id: 'quit',        label: '退出 DoTodo',      type: 'normal',   checked: false }
]
```

- `closeToTray` 和 `launchAtLogin` 的 `checked` 直接按真假值转换；缺失时为布尔值 `false`。
- `settings` 为 `undefined` 时仍返回全部 5 项，两个开关都不勾。
- `id`、`label`、`type` 必须保持上面的精确字符串；不要添加回调函数或额外的窗口层级项。

示例：

```js
planTrayMenu({ closeToTray: true, launchAtLogin: 0 })
// [
//   { id: 'show', label: '显示在桌面', type: 'normal', checked: false },
//   { id: 'hide', label: '从桌面隐藏', type: 'normal', checked: false },
//   { id: 'closeToTray', label: '关闭时隐藏到托盘', type: 'checkbox', checked: true },
//   { id: 'launchAtLogin', label: '开机启动', type: 'checkbox', checked: false },
//   { id: 'quit', label: '退出 DoTodo', type: 'normal', checked: false }
// ]

planTrayMenu(undefined).filter((item) => item.checked) // []
```

提示：先将缺失设置视为空对象，再构造固定顺序的数组；不要把生产 Electron 菜单项里的 `click` 回调复制进来。

### 2. `shouldHideOnClose({ closeToTray, isQuitting, hasTray })`

输入是状态对象，返回一个 `boolean`。字段缺失按 `false` 处理。

只有以下三个条件同时为真才返回 `true`：

- `closeToTray` 为真；
- `isQuitting` 为假，表示这不是用户主动或系统正在退出；
- `hasTray` 为真，表示托盘已经创建并且仍可提供“显示窗口”的入口。

托盘不可用时必须返回 `false`，否则窗口隐藏后用户无法找回。不要返回字符串或中间状态对象。

示例：

```js
shouldHideOnClose({ closeToTray: true, isQuitting: false, hasTray: true }) // true
shouldHideOnClose({ closeToTray: true, isQuitting: true, hasTray: true })  // false
shouldHideOnClose({ closeToTray: true, isQuitting: false, hasTray: false }) // false
shouldHideOnClose({}) // false
```

提示：把它看成一个布尔表达式；退出条件和托盘条件都不能省略。

### 3. `reconcileLaunchAtLogin(requested, effective)`

输入的 `requested` 是用户请求的开关值，`effective` 是系统读回的值。返回一个新对象，键名和类型为：

```js
{ ok, effective, rollback }
```

- `effective` 是布尔值且等于 `requested`：返回 `{ ok: true, effective, rollback: false }`。
- `effective` 是布尔值但与 `requested` 不同：返回 `{ ok: false, effective, rollback: true }`，保留系统读回值。
- `effective` 不是布尔值（例如 `undefined` 或 `null`）：视为系统不支持读回，信任请求，返回 `{ ok: true, effective: requested, rollback: false }`。
- 题目中的开关语义按布尔值处理；返回的 `effective` 必须是布尔值。

示例：

```js
reconcileLaunchAtLogin(true, true)       // { ok: true, effective: true, rollback: false }
reconcileLaunchAtLogin(true, false)      // { ok: false, effective: false, rollback: true }
reconcileLaunchAtLogin(false, undefined) // { ok: true, effective: false, rollback: false }
reconcileLaunchAtLogin(true, null)       // { ok: true, effective: true, rollback: false }
```

提示：先区分“读回值不是 boolean”和“读回的 boolean 不匹配”；不要把 `undefined` 直接当失败。

### 4. `formatShortcut(accelerator, platform)`

输入是 Electron 加速键字符串和平台字符串，返回用户可读的 `string`。

- `null`、`undefined`、空字符串返回 `''`。
- 其他输入按 `+` 拆分；每段去掉首尾空白；再用精确分隔符 `' + '` 拼回。
- 只有 `CommandOrControl` 需要替换：`platform === 'darwin'` 时写成 Unicode 字符 `'⌘'`，其他平台写成 `'Ctrl'`。
- 其他片段（如 `Shift`、`Space`、`F2`、`N`）保持原文本。

示例：

```js
formatShortcut('CommandOrControl+Shift+Space', 'win32')  // 'Ctrl + Shift + Space'
formatShortcut('CommandOrControl+Shift+Space', 'darwin')  // '⌘ + Shift + Space'
formatShortcut(' CommandOrControl + N ', 'linux')          // 'Ctrl + N'
formatShortcut('F2', 'win32')                              // 'F2'
formatShortcut(null, 'win32')                              // ''
```

提示：用 `split('+')`、逐段 `trim()` 和 `join(' + ')`；平台判断只影响那个特定 token，不要把所有按键名都改写。

### 5. `summarizeShellBoot(result)`

输入是启动结果对象，读取 `trayCreated`、`shortcut.registered` 和 `warnings`；返回：

```js
{ tray: 'ready' | 'unavailable', shortcut: 'ready' | 'conflict', messages: [...] }
```

- `trayCreated` 为真值时 `tray` 是 `'ready'`，否则是 `'unavailable'`。
- 只有 `shortcut.registered` 为真值时 `shortcut` 是 `'ready'`；缺失 `shortcut` 或缺失 `registered` 时是 `'conflict'`。
- `warnings` 是数组时，`messages` 是它的副本并过滤所有假值：`''`、`null`、`undefined`、`false`、`0` 都不保留。数组外的 `warnings` 统一得到新数组 `[]`。
- `messages` 必须是新数组，不能直接把输入的 `warnings` 数组作为返回值。

示例：

```js
summarizeShellBoot({
  trayCreated: true,
  shortcut: { registered: true },
  warnings: ['', '托盘有问题', null]
})
// { tray: 'ready', shortcut: 'ready', messages: ['托盘有问题'] }

summarizeShellBoot({})
// { tray: 'unavailable', shortcut: 'conflict', messages: [] }
```

提示：对嵌套字段使用可选读取或先提供空对象；用 `filter(Boolean)` 可表达“过滤假值”，但要记得只对数组调用。

## 代码阅读题

生产引用已核对：`src/electron/shell-controller.js` 中存在托盘菜单、关闭处理、开机启动读回、快捷键注册和销毁逻辑；窗口层级项已从生产设置和菜单中移除。

打开 `src/electron/shell-controller.js`，回答：

1. `bindWindow` 的关闭处理里为什么先判断 `isQuitting`，再判断 `tray` 和 `closeToTray`？如果先调用隐藏逻辑再判断退出状态会怎样？
2. `dispose()` 里为什么要执行 `tray = null`？不置空会发生什么？
3. `refreshMenu()` 里的 `checked` 为什么读 `getSettings()`，而不是控制器自己保存一份状态？
4. 托盘菜单的设置变更走 `onCommand` 意图，而显示/隐藏直接调用窗口方法。这个划分的依据是什么？
5. `registerShortcut` 在 `register` 返回 `true` 之后为什么还要问一次 `isRegistered`？

## 复盘问题

1. `ready`、`before-quit`、`will-quit`、`window-all-closed` 分别在什么时候触发？注册和注销资源的正确位置分别是哪个？
2. 为什么 `closeToTray` 一旦生效，`window-all-closed` 就基本不会触发了？
3. 全局快捷键和窗口内的键盘快捷键有什么区别？各自该在哪里注册？
4. 为什么“开机启动写入成功”不等于“开机启动已生效”？哪些平台最容易出现这种情况？
5. 托盘图标为什么不能用 SVG？`assets/tray.png` 和 `assets/tray@2x.png` 的分工是什么？
6. 第 6 课讲了一个做过又删掉的功能（三种窗口层级）。什么情况下“如实说明平台差异”是对的，什么情况下“干脆不做”才是对的？两者的判断标准有什么不同？

## 本题不要求处理的情况

- `reconcileLaunchAtLogin` 的 `requested` 是 `1`、`'true'` 这类非布尔真值（本题按布尔理解）
- `planTrayMenu` 的 `settings` 为 `null`（题面只约定 `undefined` 与对象）
- `formatShortcut` 遇到 `0`、`false` 这类非字符串假值，或 `'Ctrl++N'` 这种产生空片段的输入
- `summarizeShellBoot` 收到非对象（如字符串、数字）
