# 第 6 课：接入原生壳层——托盘、快捷键与开机启动

## 本课完成了什么

前五课的应用只能靠标题栏按钮操作，关掉就没了。这一课把它变成一个「住在桌面上」的程序：

| 能力 | 用到的 Electron API |
| --- | --- |
| 托盘图标与菜单 | `Tray`、`Menu.buildFromTemplate` |
| 全局显示/隐藏 | `globalShortcut.register` / `unregister` |
| 开机启动 | `app.setLoginItemSettings` / `getLoginItemSettings` |
| 关闭到托盘 | `BrowserWindow.on('close')` + `event.preventDefault()` |

新增和改动：

| 文件 | 改动 |
| --- | --- |
| `src/electron/shell-controller.js` | 新增。原生壳层的全部职责 |
| `test/electron/shell-controller.test.js` | 新增。28 个注入替身测试 |
| `src/main.js` | 组装壳层控制器，处理托盘意图，退出时处置资源 |
| `src/electron/ipc.js` | 开机启动失败不落盘、写盘后再刷新托盘菜单 |
| `src/renderer/*` | 设置面板增加两个开关与第三档层级，并把主进程的 `notice` 显示出来 |
| `tools/make-tray-icon.js` | 新增。生成 `assets/tray.png` 与 `assets/tray@2x.png` |
| `build/icon.svg` | 换成与界面品牌一致的青蓝图标 |

## 为什么这一课要单独抽一个控制器

`main.js` 的职责是**组装**：什么时候创建窗口、按什么顺序初始化、退出时清理什么。如果托盘菜单、快捷键、开机启动全都直接写在里面，它会变成一个什么都做、什么都难测的文件。

`createShellController()` 把「原生能力」收成一个有明确接口的对象：

```js
const shell = createShellController({
  app, Tray, Menu, globalShortcut,
  iconPath, platform,
  getWindow,      // () => BrowserWindow | null
  getSettings,    // () => 当前设置快照
  onCommand,      // 托盘发出的设置意图
  onError
});
```

它**只负责让操作系统发生变化**，不负责持久化。托盘里勾一下「开机启动」，控制器发出：

```js
{ type: 'launch-at-login', enabled: true }
```

由 `main.js` 决定先让系统生效、再写盘、最后刷新菜单。这样「谁拥有可信状态」这条界线在壳层这里也没有被打破——壳层和渲染进程一样，都不能直接改状态。

### 测试替身

因为全部原生对象都是注入的，测试里可以用普通对象模拟它们：

```js
class FakeTray {
  constructor(icon) { calls.push(['new Tray', icon]); }
  setToolTip(value) { this.toolTip = value; }
  setContextMenu(menu) { this.menu = menu; }
  on(event, handler) { this.clickHandler = handler; }
  destroy() { this.destroyed = true; }
}
```

于是「快捷键被别的程序占用」「托盘图标文件丢了」「系统拒绝开开机启动」这些平时很难复现的情况，都可以在 Node 里稳定重放。这就是依赖注入在这一课的实际价值。

## 托盘图标必须是位图

`Tray` 只接受 `nativeImage` 或图片路径，**不接受 SVG**。所以仓库里需要真实的 PNG：

```js
new Tray(path.join(__dirname, '..', 'assets', 'tray.png'));
```

`tools/make-tray-icon.js` 用有符号距离场把图标画出来再编码成 PNG。之所以自己写而不是塞一个二进制文件：

- 想改颜色、圆角、勾的粗细，改几行数字重跑 `npm run icons` 即可；
- 二进制文件在 Git 里没法 review，脚本可以；
- 顺便看清 PNG 到底是什么：8 字节签名 + 若干数据块，每块是「长度(4) + 类型(4) + 数据 + CRC32(4)」，像素数据按行加过滤字节后用 zlib 压缩放进 `IDAT`。

```text
assets/tray.png     16×16，100% 缩放时使用
assets/tray@2x.png  32×32，Electron 在 200% 缩放下自动选用
```

`@2x` 是 Electron 的约定：`nativeImage.createFromPath('tray.png')` 会自动把同目录的 `tray@2x.png` 作为高分辨率表示加载进来。

## 生命周期：什么时候注册，什么时候注销

```text
app.whenReady() ─┬─ 创建存储 → 领域引擎 → 窗口控制器
                 ├─ shell.initialize()      ← 托盘与全局快捷键在这里注册
                 ├─ registerIpc()
                 └─ window.load()

before-quit ────── isQuitting = true        ← 之后 close 不再被拦
will-quit ──────── ipc.dispose() / shell.dispose() / window.dispose()
window-all-closed ─ 非 macOS 时退出
```

三个要点：

**注册必须晚于 `ready`。** `Tray`、`globalShortcut`、`setLoginItemSettings` 都要求应用已就绪，在模块顶层调用会抛错。

**注销必须早于进程结束。** `globalShortcut.unregister` 不做的话，快捷键在应用退出后仍会被系统认为被占用。`dispose()` 同时做三件事：注销快捷键、销毁托盘、解绑窗口的 `close` 监听。

```js
function dispose() {
  if (disposed) return;          // 幂等：重复调用不会重复销毁托盘
  disposed = true;
  globalShortcut.unregister(accelerator);
  // ...
  if (tray) { tray.destroy(); tray = null; }
}
```

**托盘对象要一直被强引用。** 如果 `tray` 是局部变量，函数返回后它可能被垃圾回收，表现是「图标一开始在，过一会儿消失了」。`dispose()` 里的 `tray = null` 是唯一允许松开引用的地方。

## 关闭到托盘与「找不回来」的风险

无边框窗口点关闭按钮时，默认行为是销毁窗口。要做「关闭到托盘」，必须拦下来：

```js
closeHandler = (event) => {
  if (isQuitting) return;
  if (!tray) return;                                  // ①
  if (!getSettings()?.closeToTray) return;
  event.preventDefault();
  hideWindow();
};
```

注意 ①。托盘是「藏起来之后还能找回来」的唯一入口。如果托盘图标创建失败（图标文件缺失、系统托盘不可用），而窗口又被藏起来，用户就再也调不出窗口了——既看不到界面，也没有托盘菜单可以点。

所以生产代码里把「托盘是否真的建起来了」作为隐藏的前提，测试里也有一条专门覆盖：

```js
test('托盘不可用时关闭窗口不会被拦截，否则窗口会再也找不回来', () => {
  const harness = createHarness({ failTray: true });
  harness.controller.initialize();
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
  harness.windowListeners.get('close')(event);
  assert.equal(event.prevented, 0);
});
```

这条测试是写练习 06 第 2 题时想出来的：那道题要求实现 `shouldHideOnClose({ closeToTray, isQuitting, hasTray })`，写到第三个条件才发现生产代码漏了它。

`isQuitting` 由两处设置：托盘菜单的「退出」调用 `quit()`，以及 `app.on('before-quit')`。少了后者，用户从任务栏右键退出时窗口会被拦住，应用"退不掉"。

## 全局快捷键：注册成功 ≠ 真的拿到

```js
registered = globalShortcut.register(accelerator, toggleVisibility) !== false;
if (registered && !globalShortcut.isRegistered(accelerator)) registered = false;
```

`register` 返回 `false` 表示这个组合已经被别的程序占用（Windows 上很常见，比如被截图工具、输入法或另一个实例占了）。再问一次 `isRegistered` 是防御性的确认。

失败时应用不能崩，也不能假装成功——DoTodo 把结果变成一条可读的警告，通过 `getStatus()` 传给界面：

```text
CommandOrControl+Shift+Space 已被其他程序占用；可以改用托盘菜单显示窗口。
```

全局快捷键和窗口内快捷键是两回事：前者由系统分发、应用不在前台也生效，必须在主进程注册；后者是普通 DOM 键盘事件，留在渲染进程（第 4、5 课的那些 `keydown`）。

## 窗口层级：一个做过又删掉的功能

这一节原本讲怎么把「普通 / 置顶 / 桌面」三种层级映射到原生 API，以及 `desktop` 在 Windows 上
只能用「移出任务栏 + 不置顶」近似。现在三种层级**整套删掉了**。删掉的理由值得单独讲，
因为它比实现更常见：

**它是一个用户得先学会、才能做选择的概念。** 三种层级之间的差别要解释半天（"桌面"到底是
什么？和"置顶"什么关系？），而用户真正想要的只有一句话：一个常驻桌面的小部件。
把这句话变成三个选项，是让用户替产品做决定。

**它没有官方 API，所以每一端都得近似。** 删除前 `desktop` 的实现是：

```js
window.setAlwaysOnTop(false, 'normal');
window.setSkipTaskbar(true);
```

它并没有真的把窗口钉到 Windows 桌面层（那需要原生 `SetParent` 到桌面窗口），macOS 上连
等价语义都没有。也就是说：一个**本来就说不清楚、三端还不一致**的功能，被摆上了界面。

**它把窗口的堆叠行为变成了持久化状态。** 层级要存进 `settings`、要跟着快照走、要有选中态、
要在托盘菜单和设置面板两处同步——为了一个用户不需要选的选项。

现在的做法是把结论写死在窗口创建处：

```js
// src/electron/window-controller.js
alwaysOnTop: false,   // 不和别的窗口抢位置
skipTaskbar: true,    // 不进任务栏：它是小部件，不是要管理的窗口
```

`settings.windowMode` 作为**历史字段**留在 schema 里，老存档照常加载，但界面和 IPC 都不再碰它。

#### 可以带走的一条

**"能不能做到"和"该不该让用户选"是两个问题。** 三种层级都能做出来（近似也能做），
但做得出来不等于值得摆上界面。判断标准不是技术可行性，而是：**用户是不是必须理解一个新概念
才能用这个产品？** 如果是，先怀疑这个功能，而不是先怀疑用户。

这条规则在这里还有个更早的先例：背景透明度也曾经是滑杆，被删掉的原因是同一个——
它把"文字能不能看清"变成了用户能调坏的设置项（见第 4 课）。

> 平台差异仍然要如实说明，但它的去处是**文档**，不是每次操作都弹一遍的提示。
> 这条规则在后面「开机启动」一节里还会用到。

## 开机启动：写进去不等于生效

```js
app.setLoginItemSettings({ openAtLogin: value, openAsHidden: false });
const effective = readEffectiveLaunchAtLogin(value);
if (effective !== value) {
  return { ok: false, effective, error: '系统没有接受开机启动设置……' };
}
```

读回是关键步骤。macOS 上未签名或未公证的开发包经常被系统静默拒绝：调用不报错，重启后也不会自动启动。这正是「写入成功」和「已生效」的区别。

`ipc.js` 里对应地改成**失败就不落盘**：

```js
const applied = await shell.setLaunchAtLogin(value);
if (applied && applied.ok === false) return failure(applied.error, engine.getSnapshot());
return afterNativeChange(runCommand(() => engine.updateSettings({ launchAtLogin: value })), applied);
```

否则会出现最糟的状态：设置里显示「已开启」，实际根本没生效，用户下次开机才发现。测试覆盖了两层——壳层返回 `{ ok: false }`，以及 IPC 层确实没有调用 `updateSettings`。

### 读不到 ≠ 失败

有些平台（旧版 Linux、部分打包环境）根本没有 `getLoginItemSettings`。这时不能把它当成失败，否则一个正常的功能会永远报错：

```js
function readEffectiveLaunchAtLogin(fallback) {
  if (typeof app.getLoginItemSettings !== 'function') return fallback;
  ...
}
```

这是**能力探测**而不是版本判断：能调用就用结果，不能调用就信任请求值。

## 写盘之后再刷新托盘菜单

托盘菜单里的勾选状态是从设置快照投影出来的。如果先刷新菜单、再写盘，菜单会显示成旧值。所以 `ipc.js` 把刷新放在持久化之后：

```js
function afterNativeChange(result, nativeResult) {
  if (result.ok !== true) return result;
  if (typeof shell.syncSettings === 'function') shell.syncSettings(result.snapshot.settings);
  return nativeResult?.notice ? { ...result, notice: nativeResult.notice } : result;
}
```

测试直接断言顺序：

```js
assert.deepEqual(harness.calls.map(([name]) => name), ['updateSettings', 'save', 'syncSettings']);
```

托盘自己发起的变更走另一条路（`onCommand` → `main.js` 的 `handleShellIntent`），顺序同样是「先让系统生效 → 再写盘 → 最后 `refreshMenu()`」，失败则记一条运行期警告。

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo
npm start
```

应该能验证：

1. 任务栏右侧出现 DoTodo 图标，悬停显示 `DoTodo`，右键弹出菜单；
2. 菜单里勾选「开机启动」，系统设置里也能看到对应项（失败时会弹提示，且勾选会弹回）；
3. 勾上「关闭时隐藏到托盘」后点标题栏关闭，窗口消失但进程还在，托盘图标仍可唤回；
4. 按 `Ctrl/⌘ + Shift + Space` 切换显示/隐藏；
5. 托盘菜单点「退出」，进程真的结束（可以在任务管理器里确认没有残留）。

自动化：

```powershell
node test/electron/shell-controller.test.js
node test/electron/ipc.test.js
npm test
npm run smoke
```

## 常见错误

- 在模块顶层创建 `Tray` 或注册快捷键，早于 `app.whenReady()`；
- 退出时忘记 `globalShortcut.unregister`，快捷键被永久占用；
- 用局部变量保存托盘对象，图标被垃圾回收后消失；
- 托盘创建失败时仍然「关闭到托盘」，窗口再也调不出来；
- 只处理托盘菜单的退出，漏掉 `before-quit`，导致任务栏退出失效；
- 以为 `register()` 返回 `true` 就代表拿到了快捷键；
- 把近似实现说成和系统原生一致（例如"不进任务栏"不等于"钉在桌面层"）；
- 写入开机启动后不读回，界面显示了一个没生效的开关；
- 把「读不到系统状态」当成失败；
- 先刷新托盘菜单再写盘，菜单显示旧值；
- 用 SVG 当托盘图标——`Tray` 只接受位图。

## 阅读顺序

1. `test/electron/shell-controller.test.js` 的测试名：先看这个控制器承诺了什么；
2. `src/electron/shell-controller.js` 的 `assertDependencies`：它需要哪些能力；
3. `refreshMenu`：托盘菜单怎么从设置投影出勾选状态；
4. `attachCloseHandler` / `attachBeforeQuitHandler`：关闭与退出的关系；
5. `setLaunchAtLogin` / `readEffectiveLaunchAtLogin`：写入、读回、能力探测；
6. `dispose()`：资源的释放顺序；
7. 最后看 `src/main.js` 的 `handleShellIntent`，理解托盘意图怎样变成一次写盘。

## 下一课

第 7 课做导入、导出与数据恢复：把损坏文件的路径如实告诉用户、导入失败时保持当前状态不变、写一个可重复执行的 Windows 验证脚本，以及一份必须人工过一遍的验收清单。
