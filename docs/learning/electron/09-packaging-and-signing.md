# 第 9 课：打包、签名与跨平台发布

## 本课完成了什么

前八课做的是一个**能跑、能测、能解释**的应用。这一课把它变成**能交付**的东西：一个别人拿到就能装的安装包。

但这一课有一条硬门槛，写在最前面：

> **不要在人工验收通过之前做正式安装包。**

原因很实际：安装包一旦发出去，用户就会装、就会用、就会在里面存真实数据。之后你再修交互问题、改数据格式，用户的升级路径就变复杂了。所以顺序永远是：

```text
自动验证通过  →  人工验收通过  →  打包  →  签名  →  发布
```

`docs/testing/electron-windows-manual-checklist.md` 里的 11 组、约 80 项就是那道验收。

| 交付 | 文件 |
| --- | --- |
| Windows 安装包 | `release/DoTodo-Setup-<版本>-x64.exe` |
| Windows 发布清单 | `docs/release/windows-release-checklist.md` |
| macOS 发布清单 | `docs/release/macos-release-checklist.md` |
| CI 构建流程 | `.github/workflows/release.yml` |

## "打包"其实是五件事

第 8 课的附录里给过完整流水线，这里落到本项目的具体命令上：

```text
① 源码            src/**  assets/**  package.json
② 校验            npm test（142 条断言）
③ 发布到目录      npm run pack      → release/win-unpacked/
④ 安装器          npm run dist:win  → release/DoTodo-Setup-1.0.0-x64.exe
⑤ 签名与发布      （见下）
```

`pack` 和 `dist:win` 的差别只有一个：要不要生成 NSIS 安装器。**体积分类要分析的是第 ③ 步的目录**，安装器是被压缩过的，拿它做分类看不出内容构成。

### 三个体积数字，永远分开说

| 数字 | 本次实测 | 含义 |
| --- | --- | --- |
| 安装器下载体积 | 106.3 MB | 用户下载要花多少流量 |
| 打包目录体积 | 367.5 MB | 解压后落在磁盘上多大 |
| `app.asar` | 27.7 KB | 你自己的代码有多大 |

把这三个混成一句"安装包 360 MB"，用户就完全无法判断该不该优化、该优化什么。

## Windows：NSIS 安装器

```powershell
npm run dist:win
```

配置在 `package.json` 的 `build.win` / `build.nsis`：

```json
"win": {
  "target": [{ "target": "nsis", "arch": ["x64"] }],
  "artifactName": "DoTodo-Setup-${version}-${arch}.${ext}"
},
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "DoTodo"
}
```

**`oneClick: false` 是一个产品决定，不是默认值。** NSIS 默认是"点一下自动装完"，不给你选路径。对一个自用工具，让用户决定装在哪更合理。

装完之后必须验的四件事（清单里都有）：

1. **安装**：开始菜单和桌面出现快捷方式，能启动；
2. **升级**：装新版本覆盖旧版本，**用户数据必须还在**（`%APPDATA%\DoTodo` 不受影响）；
3. **开机启动**：如果之前开过，升级后仍然生效（依赖 `appId` 和 `productName` 不变）；
4. **卸载**：程序被删干净，**用户数据默认保留**（用户可能重装）。

第 2 条和第 4 条最容易出问题，因为它们跨了"程序目录"和"数据目录"两个位置——安装器只管前者。

### 代码签名：为什么会有"未知发布者"

没有签名的安装器，Windows SmartScreen 会显示：

```text
Windows 已保护你的电脑
未知发布者
```

用户得点"更多信息 → 仍要运行"。这不是 bug，是缺少代码签名证书（EV 证书或 OV 证书，需要向 CA 购买并做企业/个人验证）。

签名之后：

- SmartScreen 不再拦截（EV 证书立刻生效，OV 证书需要累积下载量）；
- 安装器属性里能看到发布者名称；
- 系统更新和某些企业策略才允许安装。

**证书和密码绝不能进仓库。** CI 里的做法是把证书的 base64 和密码放进 GitHub Secrets，构建时解码到临时目录，用完删除。这一步需要你本人去申请证书并配置，不是代码能解决的。本仓库的配置保持未签名状态，并在文档里如实说明。

## macOS：必须在 macOS 上构建

macOS 的产物**不可能**在 Windows 上做出来：`.app` bundle 的结构、`codesign`、`notarytool`、`hdiutil` 全都是 macOS 专有的。所以：

```bash
# 只能在 macOS（或 macOS CI runner）上执行
npm run dist:mac
```

产出：

| 文件 | 是什么 |
| --- | --- |
| `DoTodo-1.0.0-x64.dmg` / `-arm64.dmg` | 磁盘映像，用户打开后把 app 拖进 Applications |
| `DoTodo-1.0.0-x64.zip` / `-arm64.zip` | 压缩包，给自动更新用 |
| `release/mac/DoTodo.app` | 未压缩的应用包，签名和公证的对象 |

### 签名与公证是两件事

```text
签名（codesign）  →  证明「这个 app 来自这个开发者，且没有被改动过」
公证（notarize）  →  把 app 交给 Apple 扫描，换取一张「已检查」凭证
```

**只签名不公证，用户第一次打开会看到**：

```text
"DoTodo" 无法打开，因为 Apple 无法检查其是否包含恶意软件。
```

要完整可分发，需要：

1. Apple Developer Program 账号（付费）；
2. Developer ID Application 证书；
3. `codesign --deep --force --options runtime`（hardened runtime，公证的硬性要求）；
4. `xcrun notarytool submit ... --wait`；
5. `xcrun stapler staple DoTodo.app` 把凭证钉进 app。

### 登录项在 macOS 上更麻烦

第 6 课讲过 `app.setLoginItemSettings` 会读回系统状态。macOS 上这个读回经常返回"没生效"，原因有两层：

- **未公证的 app** 创建登录项会被系统拒绝；
- macOS 13 之后，登录项统一收进「系统设置 → 通用 → 登录项」，而且**用户可以随时关掉**，应用无权改回来。

所以第 6 课的做法在这里得到验证：**界面显示的是系统的真实状态，不是我们的期望**。如果系统拒绝了，开关必须弹回关闭并说明原因。

### `identity: null` 是什么

```json
"mac": { "identity": null }
```

它告诉 electron-builder「不要尝试查找签名证书」。本地开发时这样能构建出可运行的未签名 app；正式发布时要么删掉这一行，要么配上真实证书的 identity。

`x64` 与 `arm64` 两个架构都要构建：

- `arm64` 给 Apple Silicon；
- `x64` 给 Intel Mac，以及 Apple Silicon 上通过 Rosetta 运行的情况；
- 也可以做成 universal binary，代价是体积翻倍。

在 `macos-latest` runner（现在默认是 arm64）上构建 x64，需要 Rosetta 支持，可能失败。稳妥做法是显式指定两个 runner，或者接受 `macos-13`（Intel）与 `macos-14`（arm64）各跑一次。

## CI：什么时候构建

`.github/workflows/release.yml` 干这些事：

```yaml
on:
  push:
    tags: ['v*']          # 打 tag 才构建正式产物
  workflow_dispatch:      # 也可以手动触发，用于验证
```

流程是：checkout → 装 Node 22 → `npm ci` → **`npm test`** → 打包 → 上传产物 → 打 tag 时附加到 GitHub Release。

三个设计点：

**① 构建前先跑测试。** 一个测试挂掉的版本不该产出安装包。

**② 只上传安装器，不上传 `release/*`。** 这是个容易踩的坑：`release/win-unpacked/` 里有 367 MB 的解压文件，把 `release/*` 整个当产物上传，会把 CI 产物撑到几百 MB 而且毫无用处。要精确到：

```yaml
files: |
  release/*.exe
  release/*.dmg
  release/*.zip
```

**③ 未配置签名也能构建成功。** 产物会带"未知发布者"（Windows）或"无法检查"（macOS）提示，但至少是可验证的。签名是**加**上去的一层，不是构建的前提。

发布到 GitHub Release 需要你明确授权（涉及仓库写权限和对外可见），所以这一步留给你决定。

## 打包时可能撞上的坑

**Electron 二进制下载失败。** `npm run pack` 第一次运行需要下载 Electron 的 zip（约 100 MB），缓存在 `%LOCALAPPDATA%\electron\Cache`。网络受限时会看到：

```text
⨯ The server aborted pending request  failedTask=build
```

注意 `node_modules/electron/dist/` 里已经有解压好的 Electron，但那是给 `npm start` 用的；electron-builder 需要的是 **zip 原件**，所以它会另外下载一次。网络不通时可以通过镜像解决：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run pack
```

**NSIS 相关文件下载失败。** electron-builder 还会下载 `nsis` 和 `nsis-resources`，同样可以设 `ELECTRON_BUILDER_BINARIES_MIRROR`。

**杀毒软件锁文件。** 构建过程中 `release/` 被实时扫描占用，会报 `EBUSY`/`EPERM`。把仓库目录加进白名单。

## 运行与验证

```powershell
cd F:\杂\转开发\DoTodo

# 0. 确认人工验收已经过一遍
code docs/testing/electron-windows-manual-checklist.md

# 1. 完整自动验证
npm run verify:win

# 2. 出安装包
npm run dist:win

# 3. 按清单验收安装包本身
code docs/release/windows-release-checklist.md
```

macOS 的步骤在 `docs/release/macos-release-checklist.md`，必须在那台机器上执行。

## 常见错误

- 人工验收没过就出包，用户装了一个你还没看过的界面；
- 用 `release/*` 作为 CI 产物，把一个几百 MB 的解压目录传上去；
- 只签名不公证，用户第一次打开被 Gatekeeper 拦住；
- 把签名证书或密码提交进仓库；
- 改 `appId` / `productName`，老用户被当成新应用，数据和系统设置全丢；
- 在 Windows 上声称 macOS 已经支持，而实际上从没构建过；
- 只报一个体积数字，不区分下载 / 安装后 / 打包目录；
- 卸载时删除用户数据（用户重装后清单全没了）；
- 没有 `npm test` 就构建，产出一个测试挂掉的版本。

## 阅读顺序

1. `docs/release/windows-release-checklist.md`：发布前要过哪些门；
2. `.github/workflows/release.yml`：CI 怎么做同样的事；
3. `package.json` 的 `build` 段：target、artifactName、nsis、mac 各项；
4. `docs/learning/electron/appendix-desktop-stack-and-packaging.md` 第四节：EXE/MSI/MSIX/DMG 的区别；
5. 最后回到 `README.md`，看平台状态那一栏写的是不是实话。

## 课程到这里结束了

九课走完，你现在应该能回答：

- 一个 Electron 应用有哪几个进程，各自能做什么、不能做什么；
- 为什么界面不能直接读文件，IPC 白名单在防什么；
- 纯逻辑为什么要和框架解耦，怎么做到；
- 一个删除操作要考虑撤销、并发、跨日、损坏恢复中的哪些情况；
- 桌面应用「原生能力」的边界在哪里，做不到时怎么诚实地表达；
- 什么样的验证才算验证过；
- 一个安装包的大小到底由什么决定。

**下一步可以做的事**：

- 把 `exercises/electron/` 里还没做完的题做完，尤其是 05 的状态机和 07 的恢复逻辑；
- 挑一个第 4 课和第 5 课里没实现的功能自己加（比如任务排序持久化到独立字段、按标签分组），走一遍同样的四步循环：先写测试 → 再写实现 → 再写文档 → 再提交；
- 读一遍 `docs/superpowers/plans/2026-09-13-dotodo-electron-cross-platform.md`，对照它的九个任务看实际做了什么、哪些地方和计划不一样、为什么。

**最后一件事**：把 `CONTEXT.md` 里那几个词（Today、Day record、Task、Continuation、History）记牢。整个项目的代码之所以能写得清楚，是因为这几个词先被定义清楚了——这是最值得带走的一条经验。
