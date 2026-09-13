# 第 1 课：先写不依赖 Electron 的 JavaScript 领域层

## 本课完成了什么

这一阶段还没有创建窗口，而是先建立 DoTodo 的数据格式和业务规则：

- `src/domain/state-schema.js` 定义“什么样的数据可以被信任”；
- `src/domain/daily-todo-engine.js` 定义用户操作如何改变数据；
- `test/domain/` 使用固定时间和 ID 验证规则。

这是桌面应用开发中非常重要的一步。Electron 可以创建窗口、托盘和安装包，但它不应该决定“历史任务能不能编辑”或“跨日后是否自动搬运任务”。这些是产品规则，与操作系统无关。

## Electron 的三个运行区域

后续项目会出现三个区域：

```text
主进程 Main
  拥有 Node.js 和操作系统权限
  负责窗口、文件、托盘、快捷键

预加载脚本 Preload
  位于权限边界
  把少量安全方法提供给页面

渲染进程 Renderer
  类似普通浏览器页面
  负责 HTML、CSS、DOM 和用户交互
```

领域层不属于其中任何一个专属区域。它是普通 JavaScript：主进程可以调用，Node 测试也可以调用。这种“不知道 Electron 存在”的代码更容易验证和复用。

## 状态模型

`createState('2026-09-13')` 返回：

```js
{
  schemaVersion: 1,
  activeDay: { date: '2026-09-13', closedAt: null, tasks: [] },
  history: [],
  settings: {
    backgroundOpacity: 0.82,
    windowMode: 'topmost',
    closeToTray: true,
    launchAtLogin: false
  },
  windowBounds: { width: 390, height: 610 }
}
```

`activeDay` 是唯一可编辑日期。`history` 中的日期已经关闭，因此界面不能直接修改它们。

`schemaVersion` 是数据格式的版本。未来字段发生不兼容变化时，程序可以根据版本执行迁移，而不是猜测旧 JSON 的含义。

## 本课涉及的常用 JavaScript

### 对象展开

```js
const settings = { ...DEFAULT_SETTINGS };
```

`...` 把属性复制到一个新对象。这样每次创建状态都不会共享同一个可变设置对象。

### `Object.freeze`

```js
const DEFAULT_SETTINGS = Object.freeze({ backgroundOpacity: 0.82 });
```

它防止代码意外修改默认模板。注意：`freeze` 默认只冻结第一层，不是递归深冻结。

### `Set`

```js
const ids = new Set();
if (ids.has(task.id)) return invalid('任务 ID 重复');
ids.add(task.id);
```

`Set` 适合判断某个值是否出现过，平均查找成本低于反复扫描数组。

### `find`、`findIndex`、`some` 和 `flatMap`

- `find` 返回第一个满足条件的元素；
- `findIndex` 返回位置，找不到时是 `-1`；
- `some` 回答“是否至少有一个”；
- `flatMap` 先映射再展开一层数组。

```js
const task = tasks.find((item) => item.id === id);
const index = tasks.findIndex((item) => item.id === id);
const exists = history.some((day) => day.tasks.some((item) => item.id === id));
const allHistoryTasks = history.flatMap((day) => day.tasks);
```

### 闭包

`createDailyTodoEngine` 内部的 `state` 没有直接暴露：

```js
function createDailyTodoEngine(initialState, dependencies) {
  let state = cloneState(initialState);
  return { getSnapshot, addTask };
}
```

返回的方法仍能访问 `state`，这就是闭包。外部只能通过公开命令操作它。

### 依赖注入

真实应用需要当前时间和随机 ID，但测试需要稳定结果：

```js
const engine = createDailyTodoEngine(state, {
  now: () => '2026-09-13T10:30:00+08:00',
  createId: () => 'fixed-id'
});
```

把会变化的能力作为参数传入，叫依赖注入。它不属于某个框架，是通用设计方法。

### 严格时间与限时撤销

JavaScript 的 `Date.parse` 会接受许多非 ISO 文本，不同运行环境还可能用不同方式解释它们。DoTodo 先用正则检查完整 ISO 结构、再验证日历日期、最后才调用 `Date.parse` 得到时间戳。

删除发生时，领域引擎记录 `expiresAt = issuedAt + 6000`。渲染进程以后会显示六秒动画，但真正决定令牌是否有效的是领域引擎。否则用户即使看不到撤销按钮，仍可能通过过期 IPC 请求恢复任务。

边界约定是：正好 6000ms 仍可撤销，超过 6000ms 立即失效。测试分别覆盖 5999、6000 和 6001ms。

产品只提供“撤销最近一次删除”，所以引擎只保存一个 `undoRecord`。下一次删除会替换旧记录。这比保存不断增长的 `Map` 更符合产品语义，也避免桌面应用常驻数周后积累已经看不见的任务对象。

## 为什么返回快照

如果 `getState()` 直接返回内部对象，渲染进程可以这样绕过规则：

```js
engine.getState().history[0].tasks[0].text = '偷偷修改历史';
```

现在 `getSnapshot()` 返回深拷贝。调用方改变快照不会改变可信状态。以后 Renderer 收到的也只是快照。

当前数据只由普通对象、数组、字符串、数字、布尔值和 `null` 组成，所以 JSON 往返可以作为简单深拷贝。它不适用于 `Date`、`Map`、函数、循环引用或需要保留原型的对象。

## 运行本课测试

在仓库根目录执行：

```powershell
cd F:\杂\转开发\DoTodo
npm test
```

测试目前覆盖创建状态、拷贝隔离、完整校验、Today 操作、历史只读、限时撤销、跨日、时钟回拨、任务延续和交错删除。

## 阅读源码的推荐顺序

1. 先读测试名称，只看产品行为；
2. 再读 `createState`，理解初始数据；
3. 读 `createDailyTodoEngine` 返回的公开方法；
4. 最后读文件底部的小辅助函数；
5. 暂时不要从第一行逐字背到最后一行。

## 常见错误

- 用真实 `Date.now()` 写测试，导致第二天测试结果变化；
- 把内部数组直接交给 UI，允许 UI 绕过规则；
- 用数组索引作为任务身份，拖动后身份发生变化；
- 只检查 JSON 语法，不验证字段之间的关系；
- 把 Electron API 写进领域模块，使每次测试都必须启动 Electron。

## 下一课

下一阶段把状态安全地写入 JSON，并处理写到一半断电、主文件损坏和导入非法文件。这会进入 Node.js 的 `fs`、`path` 和临时目录。
