# 第 2 课：用 Node.js 安全保存 JSON

## 本课完成了什么

第 1 课的领域引擎只活在内存里。应用退出后，内存会消失。本课新增 `JsonStateStore`，让主进程可以：

- 把可信状态保存到 `state.json`；
- 保存第二版前，把第一版保留为 `state.backup.json`；
- 主文件损坏时尝试读取备份；
- 在恢复前原样保留损坏文件；
- 完整校验导入文件，避免非法数据替换当前状态；
- 导出一个可以再次导入的 JSON 文件。

它仍然不是 Electron 专属代码，而是普通 Node.js 模块。下一课才会由 Electron 主进程调用它。

## 为什么不用 `localStorage`

Renderer 中的 `localStorage` 用起来简单，但它属于网页存储：路径不直观、不方便做原子替换和显式备份，也不适合作为导入、导出和数据恢复的核心边界。

DoTodo 把文件操作放在主进程一侧。Renderer 以后只能通过受限 IPC 请求“保存任务”，不能随意读写用户磁盘。这既便于恢复，也符合 Electron 的权限隔离原则。

## 三个 Node.js 内置模块

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
```

- `fs` 读写文件和目录；
- `path` 按当前操作系统规则拼接路径；
- `os.tmpdir()` 返回系统临时目录，测试用它创建隔离沙箱。

不要手写 `directory + '/state.json'`。Windows 常见分隔符是 `\`，macOS 是 `/`，而 `path.join(directory, 'state.json')` 会处理平台差异。

## JSON 序列化

保存时把对象变成文本：

```js
const text = JSON.stringify(state, null, 2);
```

读取时把文本解析成值：

```js
const value = JSON.parse(text);
```

`JSON.parse` 成功只代表语法正确，不代表内容可信。`{"schemaVersion":999}` 是合法 JSON，却不是 DoTodo 支持的状态。因此读取和导入后还必须调用 `validateState`。

## 为什么不能直接覆盖 `state.json`

下面的代码很短，但程序崩溃、断电或磁盘写满时，旧文件可能已经被截断，新内容却没有写完：

```js
fs.writeFileSync('state.json', json);
```

DoTodo 使用“临时文件 + 替换”：

```text
JavaScript 对象
  → 验证
  → 写入 state.tmp.json
  → fsync 临时文件
  → 关闭文件句柄
  → 重命名为 state.json
```

`fsync` 请求操作系统把缓冲数据提交给存储设备。随后同目录重命名能把“半份 JSON 暴露给读取者”的窗口降到最低。macOS/Linux 上还会尝试同步目录元数据；Windows 不允许用相同方式同步目录，所以代码按平台分支处理。

原子写入不能代替备份：它保护“这一次写入”，备份保护“上一次有效内容”。因此第二次保存前，会把当前有效主文件写成 `state.backup.json`。

## 同步 API 与异步 API

本课使用 `readFileSync`、`writeFileSync` 和 `renameSync`。同步 API 会阻塞调用线程，不适合在高频 UI 动画或大型文件处理中使用。

DoTodo 的状态文件很小，写入发生在主进程中的离散用户命令；同步实现让“命令成功返回时已经落盘”的边界更清晰。以后如果数据量明显增长，应改成 `fs.promises`，并把多个写请求串行化，避免后一次写入超越前一次。

这是一项有条件的工程选择，不是“同步永远更好”。

## 恢复策略

`load()` 按顺序检查：

1. 主文件有效：直接返回；
2. 主文件缺失或损坏：检查备份；
3. 文件损坏：先复制为唯一命名的 `recovery-*.json`；
4. 备份有效：返回备份并给 UI 一条警告；
5. 两份都无效：返回 `state: null`，由主进程创建新状态。

损坏不等于无价值。用户可能手动修复文件，或从未损坏的片段中找回文字，所以不能在没有副本时直接覆盖它。

如果连恢复副本都无法创建，`writable` 会变成 `false`，后续 `save()` 被拒绝。宁可暂时只读，也不拿唯一的恢复证据冒险。

## 依赖注入如何模拟磁盘故障

真实的“磁盘只读”很难在每台开发机上稳定制造。构造器允许测试替换一个很小的能力：

```js
new JsonStateStore(directory, {
  copyFileSync: () => {
    throw new Error('disk is read-only');
  }
});
```

生产环境不传第二个参数，仍使用真正的 `fs.copyFileSync`。测试只替换故障边界，不伪造整个文件系统；其他测试仍在真实临时目录中读写。

## 导入为何要“先验证，后保存”

错误顺序是先覆盖当前文件，再尝试解析。正确顺序是：读取来源、解析 JSON、完整校验、最后调用 `save()`。任何一步失败，当前内存和磁盘都不应改变。

导出不改变应用当前状态，只把传入快照写到用户选择的位置。

## 本课常用 JavaScript

### `try/catch/finally`

```js
const descriptor = fs.openSync(filePath, 'w');
try {
  fs.writeFileSync(descriptor, text, 'utf8');
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
```

`finally` 无论成功还是抛错都会执行，适合释放文件句柄。

### 私有方法 `#name`

`#readCandidate()` 只能在类内部调用。它表达实现细节，不构成 UI 或其他模块可依赖的公开 API。

### 解构参数与默认值

```js
constructor(directory, { copyFileSync = fs.copyFileSync } = {})
```

调用方可以只替换需要的依赖；完全不传配置时使用真实实现。

### 三元表达式

三元表达式适合简短的二选一。嵌套过深会难读，应改成 `if` 或辅助函数。

## 运行测试

```powershell
cd F:\杂\转开发\DoTodo
node test/infrastructure/json-state-store.test.js
```

测试使用 `fs.mkdtempSync` 创建唯一目录，并且只清理测试自己创建的准确路径，不接触真实用户数据。

## 阅读源码顺序

1. 先读 7 个测试名称；
2. 看 `load`、`save`、`importFrom`、`exportTo` 四个公开方法；
3. 看 `#readCandidate` 如何区分 missing、valid、corrupt；
4. 看 `#writeJsonAtomically` 的写入顺序；
5. 最后看文件句柄与跨平台同步辅助函数。

## 复盘

- `JSON.parse` 成功为什么仍要校验状态？
- 原子写入和备份分别防什么问题？
- 为什么 Renderer 不应该直接获得 `fs`？
- 为什么导入必须在覆盖当前状态之前完成全部验证？
- 同步文件 API 在这个项目中为什么暂时可接受？

下一课会把领域层和存储层接进 Electron 主进程，并通过 Preload 暴露一组很窄的 IPC 方法给页面。
