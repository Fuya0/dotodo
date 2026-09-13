# 第 7 课：导入、导出、恢复，以及怎么知道自己做对了

## 本课完成了什么

前六课把功能做完了，但「做完」和「做对」是两件事。这一课补上后者：

| 交付 | 回答什么问题 |
| --- | --- |
| 导入 / 导出 / 打开数据目录 | 用户的数据能不能带走、能不能拿回来 |
| 损坏文件路径上报 | 出事之后，用户能不能找到自己的数据 |
| `npm run verify:win` | 一次命令跑完所有能自动化的验证 |
| 人工验收清单 | 哪些东西自动化**永远**证明不了 |

改动：

| 文件 | 改动 |
| --- | --- |
| `src/main.js` | 启动时把「已保留的损坏文件绝对路径」加进运行期警告 |
| `src/electron/ipc.js` | 无需改动——原有实现已经正确处理取消与失败，本课补测试把它锁住 |
| `src/renderer/index.html` / `app.js` / `styles.css` | 设置面板加导入/导出/打开目录，并区分「信息」和「错误」两种提示 |
| `tools/verify-electron.ps1` | 新增。Windows 自动验证脚本 |
| `docs/testing/electron-windows-manual-checklist.md` | 新增。11 组人工验收项 |
| `test/electron/ipc.test.js` | 新增 5 条导入导出边界测试 |
| `package.json` | 新增 `verify:win` 脚本 |

## 测试的四个层次

先分清每一层能证明什么，不然会误以为"测试通过 = 没问题"。

| 层次 | 本项目的例子 | 能证明 | **不能**证明 |
| --- | --- | --- | --- |
| 单元测试 | `test/domain/*`、`test/renderer/view-model.test.js` | 纯逻辑在给定输入下输出正确 | 这些逻辑有没有被真正调用 |
| 集成测试 | `test/electron/ipc.test.js`、`test/infrastructure/*` | 频道、校验、落盘、恢复连起来是对的 | 真实 Electron 能否启动 |
| 冒烟测试 | `npm run smoke` | 真实 Electron 里 Preload、IPC、DOM 真的通了 | 界面好不好看、托盘能不能点 |
| 人工验收 | `docs/testing/electron-windows-manual-checklist.md` | 透明窗口、托盘、DPI、多屏、真实数据 | 代码里没被想到的分支 |

第 3 层缺失时，最典型的翻车方式是：所有 Node 测试全绿，但应用一启动就是白屏——因为 `htmlPath` 写错了，而这一点只有真的加载页面才能发现。

第 4 层缺失时，最典型的翻车方式是：功能全对，但窗口在你 150% 缩放的副屏上糊成一片。

## 冒烟测试为什么要隔离数据目录

```js
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-smoke-'));
spawn(electronPath, ['.', '--smoke-test'], {
  env: { ...process.env, DOTODO_SMOKE_USER_DATA: dataDirectory },
  stdio: ['ignore', 'pipe', 'pipe']
});
```

主进程一侧：

```js
if (isSmokeTest) {
  const isolatedUserData = process.env.DOTODO_SMOKE_USER_DATA;
  if (!isolatedUserData || !path.isAbsolute(isolatedUserData)) {
    console.error('[DoTodo smoke] 缺少绝对路径 DOTODO_SMOKE_USER_DATA。');
    app.exit(2);
  } else {
    app.setPath('userData', isolatedUserData);
  }
}
```

三条约束缺一不可：

1. **必须是绝对路径。** 相对路径会落在「当前工作目录」，而工作目录由启动方式决定，可能正是仓库根目录。
2. **缺失就退出 2，绝不回退到默认目录。** 「配置没传就照常用真实数据」是最容易造成事故的默认值。
3. **跑完删掉自己创建的那个目录。** 只在 `try` 成功创建后记录路径，清理时只删这一个精确路径，不做任何通配。

然后冒烟测试真正去调用桥接 API，而不是只看窗口开没开：

```js
const ready = await smokeWindow.webContents.executeJavaScript(`
  (async () => {
    const state = await window.dotodo.getSnapshot();
    const dateLabel = document.querySelector('#dateLabel')?.textContent ?? '';
    return Boolean(state?.activeDay?.date && document.querySelector('#todoForm') && dateLabel.length > 0);
  })()
`);
if (!ready) throw new Error('Renderer 或 Preload 未准备完成。');
console.log('DOTODO_SMOKE_READY');
```

只有同时满足「打印了 READY」和「退出码为 0」才算通过。只看退出码不够——一个提前崩溃的进程退出码也可能是 0；只看 READY 也不够——它可能打印完之后卡住不退出。

## 导入导出：把「取消」和「失败」分开

三件事必须区分清楚：

```js
handle(CHANNELS.importData, async () => {
  const sourcePath = await dialogs.chooseImportPath();
  if (!sourcePath) return { ok: false, cancelled: true };   // 用户主动取消
  const imported = store.importFrom(sourcePath);            // 文件坏了会抛错
  ...
});
```

- **取消** → `{ ok: false, cancelled: true }`，界面**不显示任何错误**。用户点了取消不该被骂一句。
- **失败** → 抛出异常，被 `handle()` 的 `try/catch` 转成 `{ ok: false, error, snapshot }`，界面显示原因。
- **成功** → `{ ok: true, snapshot }`。

测试把这三条都锁住了：

```js
test('cancelled native dialogs are reported as cancellations, not failures', async () => {
  const cancelled = createHarness({
    dialogs: { chooseImportPath: async () => null, chooseExportPath: async () => null }
  });
  register(cancelled);
  assert.deepEqual(await invoke(cancelled, 'data:import'), { ok: false, cancelled: true });
  assert.deepEqual(cancelled.calls, []);          // 没有碰存储，也没有碰领域层
});
```

`assert.deepEqual(cancelled.calls, [])` 这一句是重点：取消不该有任何副作用。

### 无效导入必须什么都不改

`store.importFrom` 在写盘**之前**就把文件完整校验了一遍：

```js
importFrom(sourcePath) {
  const imported = this.#readRequiredState(sourcePath);   // 读 + JSON.parse + validateState
  this.save(imported);                                     // 只有通过校验才会走到这里
  return cloneState(imported);
}
```

所以「导入一个坏文件」的路径上，内存状态和磁盘状态都不会被动到。测试同时断言了 `replaceState` 和 `save` 都没被调用：

```js
assert.equal(harness.calls.some(([name]) => name === 'replaceState'), false);
assert.equal(harness.calls.some(([name]) => name === 'save'), false);
```

这是本课最重要的一条产品承诺：**用户最容易在导入时丢掉全部数据**，所以这条路径必须"要么完整成功，要么完全不动"。

## 损坏恢复：说出具体路径

存储层已经在保留损坏文件，并把路径交了出来：

```js
load() → { state, warning, preservedCorruptFiles, writable }
```

只给一句「状态文件已损坏」是不够的——用户接下来要问的是"那我的数据呢"。所以组合根把路径一条条变成警告：

```js
for (const preservedPath of loaded.preservedCorruptFiles) {
  addWarning(`损坏的原文件已保留在：${preservedPath}`);
}
```

`writable: false` 是另一条保护：如果连损坏文件都复制不出去（磁盘满、权限不足），存储层会**停止一切写入**。否则下一轮保存就会把仅存的证据覆盖掉。

```js
#assertWritable() {
  if (!this.writable) throw new Error('状态存储已停止写入：损坏文件尚未被安全保留。');
}
```

界面此时会显示「数据暂时只保存在内存中」，用户明确知道现在的状态是不可靠的——比"看起来一切正常，其实什么都没存"好得多。

## 提示信息也有语气

同一块提示区域，既要报错也要报成功。区分靠一个类：

```js
function showMessage(message, tone = 'error') {
  dom.errorArea.textContent = message;
  dom.errorArea.classList.toggle('is-info', tone === 'info');
  ...
}
```

```css
.error-area.is-info {
  border-color: var(--accent-ring);
  color: var(--ink-dim);
  background: var(--accent-soft);
}
```

「已导出到 C:\Users\…\DoTodo-2026-09-13.json」用红色报错框显示，会让用户以为出事了。主进程返回的 `notice`（例如桌面层级的说明）走的也是同一条信息通道。

## 自动验证脚本

```powershell
npm run verify:win
```

它按顺序做六件事，任何一步失败就以非 0 退出并打印失败的步骤名。

**① 环境的版本要打出来。** 「在我机器上是好的」之所以常见，就是因为没人记录过环境。Node、npm、Electron、PowerShell、操作系统版本，四行字省掉半小时扯皮。

**② 体积必须分类报，不能只报总数。**

下面是本机真实跑出来的样子（数据来自旧版 `release/win-unpacked`，仅用于演示分类格式）：

```text
分类                             大小  占比 / 文件数
--------------------------------------------------------------
可执行文件 exe                234.7 MB   63.9%  (1 个)
语言包 locales               48.3 MB   13.1%  (55 个)
动态库 dll                   39.6 MB   10.8%  (6 个)
其他                        19.5 MB    5.3%  (2 个)
Chromium 资源 pak           13.8 MB    3.7%  (3 个)
V8 / ICU 数据               11.4 MB    3.1%  (3 个)
应用代码 resources           132.7 KB    0.0%  (2 个)
配置 json                     106 B    0.0%  (1 个)
--------------------------------------------------------------
打包目录合计                   367.5 MB  (73 个文件)
app.asar                  27.7 KB    0.0%  ← 应用自身代码

安装器下载体积：106.3 MB（DoTodo-Setup-1.0.0-x64.exe）
```

一眼就能看出结论：**体积几乎全是 Chromium 和 Node.js 的运行时**，应用自身代码连千分之一都不到。只报一个 367 MB 的数字，得到的信息量是零——用户会以为是自己代码写胖了。

如果哪天体积从 370 MB 涨到 700 MB，先看「语言包」和「动态库」两行，通常是依赖里混进了新的原生模块。

**③ 下载体积、安装后体积、打包目录体积是三个不同的数字。** 不要混为一个，也不要用其中一个去暗示另一个。

**④ 内存测量前先检查应用是否在运行。**

```powershell
$running = @(Get-Process -Name 'DoTodo' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  Write-Host '检测到 DoTodo 已在运行，跳过内存测量：' -ForegroundColor Yellow
  return
}
```

两个原因：DoTodo 有单实例锁，第二个进程会立刻退出，测出来的数字没有意义；更严重的是脚本收尾时会 `Stop-Process`，如果不管不顾就会把用户正在用的窗口杀掉。

## 人工验收清单：写明「怎么造条件」

`docs/testing/electron-windows-manual-checklist.md` 有 11 组、约 80 项。它的写法有两条讲究：

**每一项都写清「怎么造出条件」。** 「验证跨日归档」不是一条可执行的指令，因为它一天只能验一次。清单写的是：

```text
4.2  关闭应用，把系统日期改到明天，重新打开
     期望：昨天整天的清单出现在历史页，未完成项不会被自动搬到今天
```

**每一项都写清「期望看到什么」，而不是「应该能用」。** 「透明度滑块工作正常」无法判定；「背景明显变透明，能看到桌面；文字仍然清晰不透明」可以判定。

清单里也标出了要留证据的项（截图/录屏）和顺序上的依赖（第 9 节必须先备份真实数据）：

```powershell
Copy-Item "$env:APPDATA\DoTodo\state.json" "$env:APPDATA\DoTodo\state.json.manual-backup"
```

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo
npm run verify:win
```

只想快速跑测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-electron.ps1 -SkipPack -SkipMemory
```

然后照着人工清单走一遍：

```powershell
code docs/testing/electron-windows-manual-checklist.md
```

**注意**：本课结束时验证脚本**只跑通了能自动化的那一半**。「环境信息」「打包产物体积分类」「验证汇总」三步已端到端实测（上面的数字就是实测输出），失败时也确实以退出码 1 结束并打印失败步骤名。但「单元测试」和「冒烟测试」两步需要在能真正启动 Electron 的环境里执行，开发沙箱不允许子进程管道通信，所以它们在本机首次执行时才算真正验证。

脚本自身的纯逻辑（字节格式化、体积分类、步骤汇总）在 `exercises/electron/07-testing/` 里有对应练习；先自己写一遍这些判断，再回头读脚本会顺很多。

另外一条环境经验：这台机器上只有 Windows PowerShell 5.1，没有 `pwsh`。所以脚本用 `#Requires -Version 5.1` 并按 5.1 的语法写，`npm run verify:win` 调用的也是 `powershell`。**含中文的 `.ps1` 文件必须存成带 BOM 的 UTF-8**——5.1 会把没有 BOM 的脚本按系统 ANSI 代码页（中文 Windows 上是 GBK）读取，结果就是满屏乱码和莫名的语法错误。

## 常见错误

- 冒烟测试用默认数据目录，跑一次就把真实清单覆盖了；
- 冒烟测试的隔离目录用相对路径，结果落在了仓库根目录；
- 只看退出码不看 `READY`（或反过来），把提前崩溃当成通过；
- 把用户点「取消」当成失败并弹错误；
- 导入时先替换内存状态、再校验文件，导致坏文件清空数据；
- 恢复后只报「文件损坏」不说保留下来的文件在哪；
- 损坏文件无法保留时还继续写入，把最后的证据覆盖掉；
- 只报一个总体积数字，看不出体积到底花在哪里；
- 内存测量不管应用是否已在运行，收尾时把用户的窗口杀掉；
- 把「自动化测试通过」当成「可以发布了」。

## 阅读顺序

1. `docs/testing/electron-windows-manual-checklist.md` 的目录：先看自动化证明不了什么；
2. `tools/verify-electron.ps1` 的 `Invoke-Step`：一个步骤怎么算通过、失败怎样汇总；
3. 同一个脚本的「打包产物体积分类」段：分类是怎么切的；
4. `tools/run-smoke.js`：隔离目录的创建、使用和清理；
5. `test/electron/ipc.test.js` 里新增的 5 条导入导出测试；
6. `src/infrastructure/json-state-store.js` 的 `load()` 与 `#preserveCorruptFile`；
7. 最后看 `src/main.js` 启动段，理解警告是怎么攒起来的。

## 下一课

第 8 课做收尾：清理旧实现与残留产物、删掉已经没用的 WPF 工作树、写课程总索引、重写 README。做完之后，这个仓库对「想学 Electron 的人」和「只想用这个工具的人」都应该是自解释的。
