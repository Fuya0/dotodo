# Windows 发布清单

发布前按顺序过一遍。**任何一步不通过就停下**，修完再从第一步重新开始。

## 当前进度

下面的历史产物数字与自动验证结果来自 `1.0.0` 发布候选记录，不代表当前源码已重新打包或验收。本轮修复后，必须按清单从第 0 步重新验证。

| 步骤 | 当前状态 | 证据 |
| --- | --- | --- |
| 0 前置条件 | 待本轮重跑 | 人工验收尚未完成 |
| 1 自动验证 | 单测 / 冒烟 / UI 已通过，完整流程未通过 | `verify:win` 八步中七步通过；打包步骤退出码 `-1073740791`，不能标记八步全绿 |
| 2 体积数字 | 旧记录 | 1.0.0 候选：安装器 106.3 MB / 打包目录 367.6 MB / `app.asar` 126.5 KB |
| 3 产物内容审计 | 旧记录 | 1.0.0 候选 asar 共 22 条；源码已变更，需重审 |
| 3b 产物可启动 | 旧记录 | 1.0.0 候选打包版曾通过；本轮源码尚未重建验证 |
| 4 创建安装包 | 旧产物 | `release/DoTodo-Setup-1.0.0-x64.exe` 早于本轮源码，不能作为本轮证据 |
| 5 安装/卸载（客观部分） | 尚未重跑 | 新增安全守卫，未运行真实安装器；需人工决定安全执行环境 |
| 5 升级 / 干净机器 / UAC / 杀毒 | ❌ 未做 | 需要干净机器或虚拟机，见下 |
| 6 代码签名 | ❌ 未做 | 未签名（预期） |
| 7 打标签 | ❌ 未做 | 需要你授权推送 |
| 8 发布后复验 | ❌ 未做 | — |

**第 5 节现在分成了两半**：安装包结构对不对已经自动化（`npm run verify:installer`），
但「干净机器上会不会出问题」这件事自动化不了，仍然要做。

> 改了 `src/`、`assets/` 或 `package.json` 之后，**安装器必须重新构建**：
> `npm run verify:win` 只重建 `win-unpacked`，不重建安装器。脚本会对比安装器和源码的时间戳，
> 发现安装器更旧时会打印黄色警告——看到它就去跑 `npm run dist:win`。
> `verify:installer` 更严格：安装器比源码旧时它直接失败，不会拿一个过期产物给你通过。

## 0. 前置条件

- [ ] 人工验收清单已全部通过：`docs/testing/electron-windows-manual-checklist.md`
- [ ] 工作区干净：`git status --short` 无输出
- [ ] 在正确的分支上：`git branch --show-current`
- [ ] `package.json` 的 `version` 是这次要发的版本号
- [ ] `appId` 和 `productName` 与上一个版本**完全一致**（改了会让老用户变成"新应用"）

```powershell
cd F:\杂\转开发\DoTodo
git status --short
node -e "const p=require('./package.json'); console.log(p.version, p.build.appId, p.build.productName)"
```

## 1. 自动验证

```powershell
npm run verify:win
```

八步：环境信息 → 单元与集成测试 → 冒烟测试 → 交互场景（13 个场景）→ 打包到目录 →
打包产物体积分类 → 打包版壳层启动 → 打包应用空闲内存。

- [ ] 退出码为 0
- [ ] 所有单元与集成测试通过
- [ ] 冒烟测试打印 `DOTODO_SMOKE_READY` 且退出码为 0
- [ ] **打包版壳层启动**报告托盘图标创建成功（这一步验的是 asar 里的真实壳层，
      `npm run smoke` 跑的是开发版，覆盖不到）
- [ ] 打包目录体积分类已打印，没有异常增长（对比上一版）
- [ ] 空闲内存数字正常（参考 60–120 MB/进程）

体积出现跳变时，先看分类表里是哪一类涨了，再看是不是新依赖引入了原生模块。

## 2. 记录体积数字

三个数字分开记，缺一不可：

| 项目 | 本版 | 上一版 | 变化 |
| --- | --- | --- | --- |
| 安装器下载体积 | | | |
| 打包目录体积 | | | |
| `app.asar` | | | |

```powershell
Get-Item release\DoTodo-Setup-*.exe | Select-Object Name, Length
$files = Get-ChildItem -File -Recurse release\win-unpacked
($files | Measure-Object Length -Sum).Sum
(Get-Item release\win-unpacked\resources\app.asar).Length
```

## 3. 产物内容审计

- [ ] `app.asar` 里**只有**源码，没有测试、课程和文档：

```powershell
npx asar list release\win-unpacked\resources\app.asar
```

  期望看到 `src/` 下的文件。如果出现 `test/`、`exercises/`、`docs/`、`node_modules/`，说明 `build.files` 配错了。

- [ ] `assets\tray.png` 和 `assets\tray@2x.png` 在包里（托盘图标是运行时读的）
- [ ] 托盘图标能在真实通知区域正常显示（不是空白方块）
- [ ] `build\icon.svg` **不在**包里（它只用于构建）

## 4. 创建安装包

```powershell
npm run dist:win
```

- [ ] 命令退出码为 0
- [ ] `release\DoTodo-Setup-<版本>-x64.exe` 存在
- [ ] 文件大小与第 2 步记录的"安装器下载体积"一致

未配置代码签名时会出现"未知发布者"警告，这是预期的，不是失败。

## 5. 安装 / 升级 / 卸载验证

第 5 节分成两半。**安装包结构对不对**已经自动化了；**干净机器上会不会出问题**自动化不了。

### 5.0 自动部分

```powershell
npm run verify:installer
```

它会静默装到临时目录，验完再静默卸载。九步：

- [ ] 退出码为 0
- [ ] 安装器存在，且**不比源码旧**（比源码旧时直接失败，不拿过期产物给你通过）
- [ ] 机器上没有已存在的 DoTodo 安装（有的话拒绝运行，不覆盖别人的卸载入口）
- [ ] 装到指定目录后，主程序和卸载器都在
- [ ] 桌面和开始菜单快捷方式都建出来了
- [ ] 注册表卸载项写进去了，**且指向这次安装的目录**（判断依据是 `UninstallString` /
      `QuietUninstallString` / `DisplayIcon`：electron-builder 的按用户安装不写
      `InstallLocation`，所以不能要求它存在）
- [ ] **装好的那份副本真的能启动**（跑它的 `--smoke-test`，要求托盘创建成功）
- [ ] 静默卸载后，程序文件、快捷方式、注册表项都清掉了
- [ ] **用户数据目录没被动过**（用完会自己卸载；脚本只读这个目录，不会删也不会建）

它会短暂在桌面上放一个「DoTodo」图标，跑完自己删掉。

### 5.1 只有干净机器能验的（必须做）

**必须在一台干净的 Windows 机器或虚拟机上做。** 开发机上残留的注册表和缓存会把问题盖住。

### 5.1.1 全新安装的外观与交互

- [ ] 双击安装器，可以选择安装目录（`oneClick: false` 生效）
- [ ] 安装完成后启动，界面正常
- [ ] `%APPDATA%\dotodo\` 被创建
- [ ] 添加几条任务，关闭再打开，数据还在
- [ ] 托盘图标出现，右键菜单完整

### 5.1.2 升级（关键）

先准备：在旧版本里添加若干任务，并打开「开机启动」。

- [ ] 直接运行新版本安装器，覆盖安装
- [ ] 安装后**任务还在**（`%APPDATA%\dotodo\state.json` 没有被覆盖）
- [ ] 「开机启动」设置仍然生效（依赖 `appId` / `productName` 未变）
- [ ] 窗口的位置和尺寸被保留
- [ ] 「任务管理器 → 启动」里还是同一个条目，没有出现两个

### 5.1.3 卸载

- [ ] 从「设置 → 应用」卸载，程序文件被删除
- [ ] 开始菜单和桌面的快捷方式消失
- [ ] `%APPDATA%\dotodo\` **保留**（用户可能重装，数据不能替用户删）
- [ ] 「任务管理器 → 启动」里的条目消失
- [ ] 重新安装后，之前的任务还能看到

### 5.1.4 系统行为

- [ ] 安装时没有触发 UAC（当前是 per-user 安装；如果需要 per-machine 安装，得改 NSIS 配置）
- [ ] 杀毒软件没有误报
- [ ] 安装完成后，本用户之外的其他用户看不到这个应用

## 6. 代码签名（可选，但正式对外发布建议做）

当前状态：**未签名**。

- [ ] 已购买代码签名证书（OV 或 EV）
- [ ] 证书和密码存进 CI Secrets，**没有进仓库**：

```powershell
git log --all --full-history -- "*.pfx" "*.p12"
```

- [ ] 签名后的安装器属性里能看到发布者名称
- [ ] SmartScreen 不再拦截（EV 立即生效；OV 需要累积下载量）
- [ ] **在一台从未装过的干净机器上验证过**

## 7. 打标签

```powershell
git tag -a v1.0.0 -m "DoTodo v1.0.0"
git push origin v1.0.0
```

- [ ] tag 名字与 `package.json` 的 `version` 一致（CI 用 `v*` 触发）
- [ ] 推送前确认没有未提交的改动

推 tag 会触发 CI 构建 Windows 与 macOS 产物。**CI 默认只上传产物，不会自动发布到 GitHub Release**——发布需要单独授权。

## 8. 发布后

- [ ] 从 GitHub Release 下载安装器，在干净机器上再装一次（验证上传的产物是好的）
- [ ] 计算并公布文件的 SHA-256：

```powershell
Get-FileHash release\DoTodo-Setup-1.0.0-x64.exe -Algorithm SHA256
```

- [ ] 发布说明里写清：支持的系统、是否签名、已知限制
- [ ] 在发布说明里**不要**写"支持 macOS"，除非 macOS 清单也过了

## 回滚预案

- [ ] 知道上一个可用版本的 tag 名
- [ ] 知道用户数据格式是否变化（`schemaVersion` 变了就要写迁移说明）
- [ ] 如果新版本有严重问题，能撤下 Release 并说明

## 记录

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 1 自动验证 | | |
| 2 体积数字 | | |
| 3 产物内容审计 | | |
| 4 安装包生成 | | |
| 5a 安装 / 卸载（`npm run verify:installer`） | | |
| 5b 升级 / 干净机器 / UAC / 杀毒 | | |
| 6 代码签名 | | |
| 7 打标签 | | |
| 8 发布后复验 | | |
