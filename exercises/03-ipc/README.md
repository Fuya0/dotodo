# 练习 03：能力分工与安全 IPC

本组 4 题。在 Node 中使用测试提供的普通对象模拟 Electron，不启动 Electron、不读取真实文件、不需要 `require('electron')`。

## 打开哪个文件、怎么做

打开本目录的 `starter.js`，一次只替换一个函数里的占位 `throw`，写逻辑并返回题目要求的值。函数名、参数、底部导出不改；`starter.test.js` 不改。

```powershell
cd 'F:\杂\转开发\DoTodo-learning'
node exercises/03-ipc/starter.test.js
```

只检查第 2 题：

```powershell
node --test --test-name-pattern='^createSafeApi ' exercises/03-ipc/starter.test.js
```

后面没做的题继续红着是正常的。第 4 题的紧凑模式是教学例子，不表示当前软件真的有这个设置。

## 题目

### 1. `classifyCapability(name)`

**输入：** 一个能力名称。这里只需要按下面的固定映射归类，不是真的创建窗口或操作文件。

**返回：** 小写字符串，未知名称或其他输入返回 `'unknown'`。

| `name` | 返回 |
| --- | --- |
| `'createBrowserWindow'` | `'main'` |
| `'readStateFile'` | `'main'` |
| `'exposeTodoApi'` | `'preload'` |
| `'renderTaskList'` | `'renderer'` |
| `'listenForClick'` | `'renderer'` |
| 其他 | `'unknown'` |

```js
classifyCapability('readStateFile') // 'main'
classifyCapability('mystery')       // 'unknown'
```

**提示：** 可以用条件分支或映射对象。任务名称是字符串，不是待调用的函数。

### 2. `createSafeApi(ipcRenderer)`

**输入：** 测试提供的对象，拥有 `invoke(channel, ...args)` 方法；它返回 Promise。本题不是让你自己实现 `invoke`。

**返回：** 用 `Object.freeze` 冻结的对象，恰好暴露两个方法：

| 返回对象的方法 | 调用它时要做什么 |
| --- | --- |
| `getVersion()` | 调用并返回 `ipcRenderer.invoke('app:get-version')` 的结果，不带额外参数 |
| `setCompactMode(enabled)` | 调用并返回 `ipcRenderer.invoke('settings:set-compact-mode', enabled)` 的结果 |

```js
const api = createSafeApi(ipcRenderer);
// 此时只是创建方法，不应已经发出 IPC 调用
await api.getVersion();           // 发出 app:get-version
await api.setCompactMode(false);  // 发出 settings:set-compact-mode，并传 false
```

不能额外暴露原始 `invoke`、`send` 或 `ipcRenderer`。不要把 Promise 包成 `{ ok, value }`，也不要丢掉返回值。`setCompactMode` 在本题只转发参数；第 4 题才负责在主进程侧验证。

**提示：** 区分“把函数放进对象，等以后调用”和“创建对象时就调用函数”。

### 3. `isStrictBoolean(value)`

**输入：** 任意 JavaScript 值。

**返回：** 布尔值。只有输入本身是 `true` 或 `false` 才返回 `true`；其余都返回 `false`。

```js
isStrictBoolean(false)   // true：false 也是合法布尔
isStrictBoolean('false') // false：这是字符串
isStrictBoolean(0)       // false
isStrictBoolean(null)    // false
```

**提示：** 这不是 `Boolean(value)` 的真假值转换；可以检查 `typeof`。

### 4. `registerCompactMode(ipcMain, settings)`

**输入：** 两个测试替身对象：

- `ipcMain.handle(channel, handler)` 注册处理函数；`ipcMain.removeHandler(channel)` 移除它。
- `settings.setCompactMode(value)` 应用设置；它的返回值不用于生成本题的响应。

**本函数现在要做的事：** 调用一次 `ipcMain.handle`，注册频道 `'settings:set-compact-mode'`。注册时不能立刻调用设置方法。

**以后 handler 被调用时做的事：** handler 接收 `(event, value)` 两个参数；第一个参数是事件对象，本题忽略它，真正的设置值是第二个参数。

| 第二个参数 `value` | handler 返回 | 副作用 |
| --- | --- | --- |
| `true` 或 `false` | `{ ok: true, value: 传进来的布尔 }` | 调用一次 `settings.setCompactMode(value)` |
| 其他值 | `{ ok: false }` | 不调用设置方法 |

例如 `handler({}, 'true')` 返回 `{ ok: false }`，`handler({}, true)` 返回 `{ ok: true, value: true }`。

**本函数的返回值：** 一个对象 `{ dispose: 一个函数 }`，不是直接返回那个函数，也不是调用它之后的结果。调用 `registration.dispose()` 时，移除同一个频道：

```js
const registration = registerCompactMode(ipcMain, settings);
// 此时频道已经注册
registration.dispose();
// 此时调用 ipcMain.removeHandler('settings:set-compact-mode')
```

handler 可以同步返回对象，也可以用 `async` 返回对象，现有测试两种都能等待。本题不要求处理原生调用抛错、重复注册或重复 dispose 的扩展场景。

**提示：** 这里有三件不同时间发生的事：现在注册 → 收到请求才校验和应用 → dispose 时移除。不要把它们都放在注册那一刻执行。

## 做完再回答（不参与自动判分）

1. `false` 和 `'false'` 为什么不能等同处理？
2. 为什么页面只能请求固定频道，不能选择任意频道或任意文件路径？
3. 调用 `createSafeApi` 时为什么不应立即发出两条 IPC 请求？
4. `event` 是 handler 的第一个参数，为什么判断布尔时应该看第二个参数？
5. Preload 已经校验参数，Main 为什么仍然应该校验？

## 本题不要求处理的情况

- `registerCompactMode` 返回的 `dispose()` 自身的返回值（不判分）
- handler 用同步还是 `async` 返回（两种都通过）
- 重复注册同一频道、重复调用 `dispose()`、`settings.setCompactMode` 抛异常
- `createSafeApi` 的 `ipcRenderer.invoke` 拒绝（Promise reject）时的行为
