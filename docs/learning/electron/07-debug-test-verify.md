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

## 测试的五个层次

先分清每一层能证明什么，不然会误以为"测试通过 = 没问题"。

| 层次 | 本项目的例子 | 能证明 | **不能**证明 |
| --- | --- | --- | --- |
| 单元测试 | `test/domain/*`、`test/renderer/view-model.test.js` | 纯逻辑在给定输入下输出正确 | 这些逻辑有没有被真正调用 |
| 集成测试 | `test/electron/ipc.test.js`、`test/infrastructure/*` | 频道、校验、落盘、恢复连起来是对的 | 真实 Electron 能否启动 |
| 静态约束 | `test/renderer/markup.test.js`、`test/tools/ui-scenarios.test.js` | 选择器对得上、渲染层没偷偷 require Node、界面上没有不该出现的元素 | 任何运行期行为 |
| 冒烟测试 | `npm run smoke` | 真实 Electron 里 Preload、IPC、DOM 真的通了 | 界面好不好看、点一下会怎样 |
| 交互场景 | `npm run ui-check` | 在真实渲染进程里点击、按键之后 DOM 和数据变成什么样 | 托盘、DPI、多屏、真实安装 |
| 人工验收 | `docs/testing/electron-windows-manual-checklist.md` | 透明窗口、托盘、DPI、多屏、真实数据、手感 | 代码里没被想到的分支 |

第 4 层缺失时，最典型的翻车方式是：所有 Node 测试全绿，但应用一启动就是白屏——因为 `htmlPath` 写错了，而这一点只有真的加载页面才能发现。

第 5 层缺失时，最典型的翻车方式是：**改了一版配色，顺手删掉了一个元素，结果某个交互悄悄坏了，而所有测试仍然是绿的。**
这个项目真的踩过：把透明度滑杆从设置面板里拿掉之后，只有静态检查能发现「元素不在了」，
但「拿掉之后设置面板的其他开关还能不能点」没有任何测试覆盖。交互场景就是补这个洞的。

第 6 层永远补不满：自动化看不见你的显示器。但它覆盖的越多，"人工验收"就越只剩真正的
人眼项目，而不是把「点一下按钮」也算进去。

### 交互场景也能检查 DOM 以外的东西

有些行为的结果不在界面上，而在磁盘上：跨日归档之后 `state.json` 里到底是什么、
损坏恢复有没有留下证据。渲染进程读不了文件，所以场景可以配一个 Node 侧的
`<场景名>.case.js`：

```js
module.exports = {
  fixture: () => state,          // 起始存档（返回 null 表示不写）
  prepare: (userData) => {},     // 写完存档后调用，可以造损坏现场
  verify:  (userData) => [...]   // 进程退出后检查磁盘，返回断言
};
```

有了它，验收清单里最涉及数据安全的两节就能自动化了：

| 场景 | 起始存档 | 磁盘断言 |
| --- | --- | --- |
| `rollover` | 「今天」是昨天 | 当天推进到今天、昨天整天进了历史、未完成项没被搬过来 |
| `clock-rollback` | 「今天」是明天 | 日期没被回退、历史没被凭空产生 |
| `corrupt-recovery` | 主文件是 `{broken`，备份完好 | 坏文件被一字不差保留、9 条任务从备份恢复 |
| `corrupt-both` | 两份都是坏内容 | 两份证据都保留、应用仍可用、没有凭空编造数据 |
| `continuation` | 默认演示存档 | 删掉目标后 `hasBeenContinued` 仍为 true（终身只能延续一次） |

**注意这个模式的一个陷阱**：`verify` 是在进程退出之后跑的，它看到的是**最终状态**。
如果场景中间改了数据，断言就必须按最终状态写。我在这上面连错三次——
每次都以为是产品 bug，其实是我在场景末尾加了任务却在断言里按原始条数算。

## 守卫也可能是假的：一次真实的自查

验收清单顶部有两张表：哪些已经自动化、哪些仍然只能人工。它们是**声称**——
声称覆盖了却没覆盖，比不声称更糟，因为读者会把时间省下来却漏掉真正的检查。

所以我给这两张表写了一条守卫：正文里每一条都必须出现在其中一张表里。写完之后它通过了，
我还顺手确认了一遍"87 条全部有归属"。**但那条守卫是假的。**

它的实现是在整份文档里找"只含编号的单元格"：

```js
for (const match of document.matchAll(/\| ((?:\d+\.\d+[、，]?\s*)+) \|/g)) { ... }
```

问题在于，**正文表格每一行的第一列就是编号**。于是每一条都匹配到了自己的编号列，
判定为"已分类"，守卫永远通过。

发现它纯属意外：我按惯例做了一次探针——故意往正文插一条未分类的 `10.9`，
看守卫会不会报警。结果它没报。修掉扫描范围（只扫两张分类表所在的段落）之后再探，
它不但报了 `10.9`，还顺带揪出**5 条一直没被分类的真实条目**。

教训有两条：

1. **守卫写完必须用探针证明它会失败。** 一条从没红过的守卫，和没有守卫是一样的，
   而且更危险——因为它会让人以为自己有覆盖。
2. **扫描整份文档的守卫会匹配到自己的主语。** 检查"文档里每个 X 都被 Y 提到"时，
   必须先限定在 Y 所在的区域里扫，否则 X 自己就会满足条件。

这两条已经写进 `test/tools/checklist.test.js` 的注释里，免得下次又踩。

## 动手：把运行器拆成可以纯函数测试的部分

运行器看起来全是"和 Electron 打交道"的代码，其实里面一半是普通判断。把它们抽出来，
就能用 `node --test` 秒级验证，不用启动浏览器。

```powershell
node exercises/electron/07-testing/starter.test.js
```

| 题目 | 它在运行器里管什么 |
| --- | --- |
| `isScenarioFile` | 从 `test/ui/` 里挑出真正的场景，排除 `_prelude.js` 和 `*.case.js` |
| `extractDriveResult` | 从 Electron 的一大堆输出里取出 JSON 结果 |
| `summarizeScenarios` | 汇总断言数与失败数，并算出退出码 |
| `withinDeadline` | 等待循环什么时候该放弃 |
| `fitsInside` | 界面元素有没有压到别人身上 |
| `diffFileNames` | 数据目录里多了什么、少了什么 |

### 为什么这些判断值得单独测

`isScenarioFile` 就是反例：它一开始只判断了「以 `.js` 结尾」，于是把 Node 侧的
`*.case.js` 也当成场景丢进渲染进程执行。报出来的错是「选择器找不到元素」，
和真正的原因（文件根本不是场景）差了十万八千里，排查绕了一大圈。

正确的规则是三条一起：

```js
typeof name === 'string' && name.length > 3 &&
name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.case.js')
```

`name.length > 3` 那条容易被忽略：`'.js'` 满足「以 .js 结尾」，但它不是文件名。
**边界条件不是想出来的，是写测试写出来的。**

### 等待循环：为什么"等条件"比"等时间"难写

```js
async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (predicate()) return true;
    } catch {
      // 元素还没出现时 predicate 可能抛错，当作"还没到"
    }
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}
```

四件事各自都能写错：

1. **`try/catch` 包住 predicate。** 你想判断的元素可能还不存在，`q('#x').hidden` 会直接抛。
   不包起来，第一次轮询就把整个场景炸掉。
2. **先判断再检查超时。** 如果顺序反过来，一个立刻为真的条件也要白等一个间隔。
3. **`>` 而不是 `>=`。** 正好到点仍算在窗口内——这是一条要写进测试的约定，不然
   不同人的实现会在边界上不一致。
4. **固定间隔 25ms，不做退避。** 界面变化通常在几十毫秒内，退避只会让常见情况变慢。

`withinDeadline(startedAt, now, timeoutMs)` 就是把第 3 条抽出来：
把时间当参数传进去，测试就能直接钉住"正好到点"和"超过一毫秒"两个边界，不用真的等。

### 几何断言：把"我看了一眼"变成可执行的

提示条压住标题那个缺陷，肉眼一看就知道。问题是**下次改动时没人会再看一眼**。
所以把它写成数字：

```js
const bandRect = band.getBoundingClientRect();
const headingRect = q('#todayPage .hero h1').getBoundingClientRect();
check('提示条不遮挡页面标题', bandRect.bottom <= headingRect.top + 1);
```

`+1` 是容差，用来吸收亚像素取整。`fitsInside(inner, outer, tolerance)` 就是这条断言的
通用版本，同时也用于"提示条没有超出窗口宽度"。

几何断言能守住"不重叠""不溢出""不超过视口多少比例"，守不住"好不好看"。
分清楚这个界线，就不会写出假装能测视觉的测试。

### 数据目录的差异断言

损坏恢复之后，数据目录里应该发生这些变化：

```text
+ recovery-primary-2026-....json     新增：坏文件被保留
  state.json                          内容变了（从备份恢复）
  state.backup.json                   内容变了（轮转）
```

`diffFileNames(before, after)` 用来表达"新增/删除/保留"这三件事。
用**集合**而不是计数：坏备份可能被保留不止一份（`load()` 一次、`save()` 轮转时又一次），
所以断言应该是「每一份保留文件都一字不差」，而不是「只保留一份」。

**这就是"断言要描述真正的保证"**：写成计数会在实现变化时假失败，
写成集合语义才对应产品真正承诺的东西。

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

「已导出到 C:\Users\…\DoTodo-2026-09-13.json」用红色报错框显示，会让用户以为出事了。

**但也不是所有信息都该显示。** 判断标准是「用户需不需要现在知道」：

| 信息 | 该不该弹 | 为什么 |
| --- | --- | --- |
| 保存失败、数据损坏 | 该 | 用户此刻必须知道数据不在了 |
| 导入完成、导出到某路径 | 该（信息色） | 用户要确认操作生效了 |
| 托盘图标创建失败 | **该** | 用户会以为应用根本没启动，得知道它只是没进托盘 |
| 全局快捷键被其他程序占用 | **不该** | 非致命降级，应用照常能用；写进控制台日志即可 |
| `Ctrl + N` 能聚焦输入框 | **不该** | 底部常驻的快捷键提示属于装饰，不是信息 |

后三条在最初实现里全都占着界面位置，其中快捷键警告甚至用绝对定位**盖住了页面标题**。
现在它们要么进了文档，要么只写日志。

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

**每一项都写清「期望看到什么」，而不是「应该能用」。** 「设置面板工作正常」无法判定；
「面板里只有关闭到托盘、开机启动、数据、数据目录，没有透明度滑杆也没有窗口层级」可以判定。

清单里也标出了要留证据的项（截图/录屏）和顺序上的依赖（第 9 节必须先备份真实数据）：

```powershell
Copy-Item "$env:APPDATA\dotodo\state.json" "$env:APPDATA\dotodo\state.json.manual-backup"
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

**注意**：这条流水线现在**已经完整跑通过**（退出码 0），六个步骤全绿：

```text
环境信息                 passed
单元与集成测试 (npm test)   passed
冒烟测试 (npm run smoke) passed
打包到目录 (npm run pack) passed
打包产物体积分类             passed
打包应用空闲内存             passed
```

上面那张体积分类表就是实测输出（`app.asar` 约 119 KB）。

两次真实的失败值得记下来，因为它们都不是"代码写错了"，而是环境问题：

**① 从 GitHub 下载 Electron 二进制会中断。**

```text
⨯ The server aborted pending request  failedTask=build
```

`node_modules/electron/dist/` 里已经有解压好的运行时，但 electron-builder 需要的是 **zip 原件**，
所以它会另外下载一次到 `%LOCALAPPDATA%\electron\Cache`。国内网络下设置镜像即可（实测有效）：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

**②「打包后的应用没起来」不一定是应用的问题。**

内存测量那一步第一次跑是**失败**的，报「DoTodo 进程没有起来」。查下去才发现：开发版
（`npm start`）的进程名叫 `electron`，安装版叫 `DoTodo`，而两者**共用同一个数据目录、也就共用
同一把单实例锁**。只要有任何一个在跑，新起的打包版就会以**退出码 0 静默退出**——不是崩溃。

原来的检测只找 `DoTodo`，于是既漏判了「有实例在跑」，又把退出码 0 误报成故障。修好之后它
会明确说「检测到 4 个 DoTodo 进程正在运行，跳过内存测量」。

这条经验可以推广：**退出码 0 加上"什么都没发生"，优先怀疑单实例锁，而不是怀疑代码。**

### 顺带一说：这个 `.ps1` 必须带 BOM

`tools/verify-electron.ps1` 里有大量中文，而 Windows PowerShell 5.1 会用系统 ANSI 代码页
（中文 Windows 上是 GBK）读取**没有 BOM** 的脚本。BOM 一丢，整个文件变成乱码加一串莫名其妙的
语法错误——而且报错位置全在无关的行上，极难定位。

很多编辑器（包括本仓库开发过程中用到的文件写入工具）会顺手把 BOM 剥掉，所以
`test/tools/verify-script.test.js` 专门断言了前三个字节必须是 `EF BB BF`。
**能自动发现的坑就不要靠记性。**

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
