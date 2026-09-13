# 练习 02：文件路径、JSON 与恢复决策

## 目标

手写几个存储层的小函数，熟悉 `path`、`JSON.parse`、判别结果、错误边界和不可变返回值。练习不会读写 DoTodo 的真实数据文件。

## 使用方法

打开同目录的 `starter.js`，依次替换抛错占位。每完成一题运行：

```powershell
node --test exercises/electron/02-storage/starter.test.js
```

这些练习测试故意不属于项目的 `npm test`，所以你未完成练习时不会让产品测试变红。

## 题目

### 1. `makeStatePaths(directory)`

使用 `path.resolve` 和 `path.join` 返回主文件、备份和临时文件的绝对路径。不要手写斜杠。

### 2. `safeParseJson(text)`

解析成功返回 `{ ok: true, value }`；失败返回 `{ ok: false, error }`，不能把异常抛给调用方。

### 3. `classifyCandidate(text, validate)`

- `text === null` 表示文件不存在，返回 `{ kind: 'missing' }`；
- JSON 语法错误返回 `{ kind: 'corrupt' }`；
- 调用传入的 `validate(value)`；
- 校验成功返回 `{ kind: 'valid', value }`，否则返回 corrupt。

这里练习“传入函数”：存储工具不需要知道所有产品字段，只负责组织解析和校验步骤。

### 4. `chooseLoadResult(primary, backup)`

输入两个候选结果：优先有效主文件，其次有效备份，否则返回空状态。返回值还要包含 `source: 'primary' | 'backup' | 'empty'`。

### 5. `serializeState(state)`

返回带两格缩进、末尾有一个换行符的 JSON。确认它不会修改传入对象。

## 加餐手写题

不用复制项目代码，写出原子保存的伪代码，至少包含：验证、写临时文件、同步、关闭、替换五步。然后解释如果直接覆盖 `state.json`，在哪一步崩溃会留下半份文件。

## 复盘问题

1. `path.resolve` 与 `path.join` 分别解决什么问题？
2. 什么是“合法 JSON 但非法业务状态”？举一个例子。
3. 为什么 `catch { return defaultState }` 可能导致用户无声丢数据？
4. 备份应该保存刚写入的新状态，还是替换前的旧状态？
5. 如果改用异步 API，两个快速连续的保存请求可能出现什么竞态？
