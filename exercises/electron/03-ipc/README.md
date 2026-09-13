# 练习 03：手写一条安全 IPC 链路

## 目标

理解 Main、Preload、Renderer 的职责，手写一个窄 API，并用记录型替身验证频道和参数。

## 使用方法

打开 `starter.js`，完成占位函数后运行：

```powershell
node --test exercises/electron/03-ipc/starter.test.js
```

练习测试不包含在产品 `npm test` 中，未完成不会影响应用验证。

## 题目

### 1. `classifyCapability(name)`

把能力归到正确区域：

- `createBrowserWindow`、`readStateFile` → `main`；
- `exposeTodoApi` → `preload`；
- `renderTaskList`、`listenForClick` → `renderer`；
- 未知值 → `unknown`。

### 2. `createSafeApi(ipcRenderer)`

返回冻结对象，只暴露：

```js
getVersion()
setCompactMode(enabled)
```

分别固定调用 `app:get-version` 和 `settings:set-compact-mode`。不能暴露原始 `invoke`。

### 3. `isStrictBoolean(value)`

只有 `true` 和 `false` 返回 true。字符串、数字和 null 都返回 false。

### 4. `registerCompactMode(ipcMain, settings)`

注册 `settings:set-compact-mode` handler。非法值返回 `{ ok: false }`，且不能调用 `settings.setCompactMode`；合法值调用一次并返回 `{ ok: true, value }`。

函数返回 `dispose()`，用于移除 handler。

## 代码阅读题

找出下列三种危险并写下原因：

```js
window.bridge = { ipcRenderer };
window.bridge.read = (path) => fs.readFileSync(path, 'utf8');
window.bridge.call = (method, args) => ipcRenderer.invoke(method, args);
```

提示：分别思考“频道选择权”“文件路径选择权”“攻击代码能获得什么”。

## 复盘问题

1. `ipcRenderer.invoke` 为什么返回 Promise？
2. Preload 校验过参数后，Main 为什么仍要再校验？
3. `nodeIntegration: false` 解决了什么问题？
4. `contextIsolation: true` 后，页面和 Preload 的全局对象是什么关系？
5. 为什么应用退出或测试结束时要移除 IPC handler？
