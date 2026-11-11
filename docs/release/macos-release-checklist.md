# macOS 发布清单

> **本清单尚未执行过。** 项目到目前为止只在 Windows 上构建和验证过。
> 下面每一条都是待办，不是"已完成"的记录。没有跑过之前，对外不要说 DoTodo 支持 macOS。

## 0. 前提

- [ ] 一台 macOS 机器（或 macOS CI runner），Xcode Command Line Tools 已装：

```bash
xcode-select --install
```

- [ ] Node.js 22.12+
- [ ] 确认 `package.json` 的 `build.mac` 目标符合预期：

```json
"mac": {
  "target": [
    { "target": "dmg", "arch": ["x64", "arm64"] },
    { "target": "zip", "arch": ["x64", "arm64"] }
  ],
  "category": "public.app-category.productivity",
  "artifactName": "DoTodo-${version}-${arch}.${ext}",
  "identity": null
}
```

`identity: null` 表示**不签名**。本地验证可以这样；正式发布要改成真实证书。

## 1. 源码层面的平台适配检查

这些地方在代码里已经处理，但**必须在真机上确认**：

- [ ] 快捷键用的是 `CommandOrControl`，在 macOS 上应显示为 `⌘`：

```bash
grep -n "CommandOrControl" src/electron/shell-controller.js
```

- [ ] `window-all-closed` 在 macOS 上不退出应用：

```bash
grep -n "darwin" src/main.js
```

- [ ] 关闭按钮的行为：macOS 用户习惯是「关掉窗口但应用还在」，确认 `closeToTray` 的默认值在这里是否合适
- [ ] Dock 图标的右键菜单是否合适（Electron 有 `app.dock`，本项目未使用）
- [ ] 托盘图标在 macOS 菜单栏里是**彩色**的，而 macOS 惯例是单色 template image。可能需要额外提供 `trayTemplate.png` 并在 `nativeImage.setTemplateImage(true)` 上切换

最后一条大概率需要改代码，先记下来。

## 2. 构建

```bash
npm ci
npm test
npm run dist:mac
```

- [ ] `npm test` 全部通过（数量以本次运行结果为准）
- [ ] 构建退出码为 0
- [ ] 产物齐备：

```bash
ls -lh release/*.dmg release/*.zip
```

期望四个文件：`x64.dmg`、`arm64.dmg`、`x64.zip`、`arm64.zip`。

- [ ] 分别记录下载体积、安装后体积、`.app` 体积

## 3. 运行验证

### 3.1 未签名状态

```bash
open release/mac-arm64/DoTodo.app
```

- [ ] 首次打开被 Gatekeeper 拦住（"无法打开，因为 Apple 无法检查其是否包含恶意软件"）
- [ ] 通过「右键 → 打开」可以绕过并运行（这是未签名 app 的正常路径）
- [ ] 界面渲染与 Windows 一致：深色玻璃、圆角、无标题栏
- [ ] 窗口可以拖动（`-webkit-app-region: drag` 在 macOS 上生效）
- [ ] 红黄绿三个交通灯按钮的行为：本项目用的是 `frame: false`，确认关掉窗口后应用状态是否符合预期
- [ ] 固定的半透明背景下文字保持清晰，界面没有透明度滑块
- [ ] 中文显示正常（字体回退到 PingFang SC）

### 3.2 托盘 / 菜单栏

- [ ] 菜单栏出现图标
- [ ] 图标为单色 template 样式（如果还是彩色，按第 1 节的最后一条修改）
- [ ] 深色菜单栏下图标可见
- [ ] 右键菜单项完整，中文正常
- [ ] 点击菜单栏图标能显示 / 隐藏窗口

### 3.3 窗口的堆叠行为

三种窗口层级已经删掉，窗口固定为「不置顶 + 不进任务栏」（macOS 上是移出 Dock 与窗口切换器）。

- [ ] 它压在别的窗口下面，不抢焦点、不挡工作
- [ ] 不出现在 Dock 与 `⌘Tab` 切换器里
- [ ] 点桌面或切到别的应用之后，它还在原来的位置（没有被系统挪走）

### 3.4 全局快捷键

- [ ] `⌘ + Shift + Space` 能切换窗口显示
- [ ] 与系统或常用应用（Spotlight、输入法、截图）没有冲突
- [ ] 冲突时应用显示警告而不是崩溃

### 3.5 开机启动

- [ ] 打开后，「系统设置 → 通用 → 登录项」里出现 DoTodo
- [ ] 注销重新登录后自动启动
- [ ] **未签名时很可能失败**——确认此时界面把开关弹回关闭并给出原因，而不是显示"已开启"
- [ ] 手动在系统设置里关掉登录项后，重新打开 DoTodo，界面显示的应该是系统的真实状态

第 3、4 条是第 6 课 `readEffectiveLaunchAtLogin` 的设计是否成立的关键验证。

### 3.6 数据目录

- [ ] 数据写在 `~/Library/Application Support/dotodo/state.json`
- [ ] 设置里的「打开数据目录」能唤起 Finder
- [ ] 导出、导入、损坏恢复三条路径都能用
- [ ] 跨日归档在本地时区下正确（macOS 时区设置可能与 Windows 不同）

## 4. Intel 与 Apple Silicon

- [ ] 在 Intel Mac 上跑 `x64` 包
- [ ] 在 Apple Silicon 上跑 `arm64` 包
- [ ] 在 Apple Silicon 上通过 Rosetta 跑 `x64` 包（提示安装 Rosetta 后可以运行）
- [ ] 两个架构下的界面、托盘、快捷方式行为一致
- [ ] 没有出现"应用已损坏"（那是签名/公证问题，不是架构问题）

## 5. 签名与公证（正式发布必须）

### 5.1 准备

- [ ] Apple Developer Program 账号（付费）
- [ ] Developer ID Application 证书已导入钥匙串：

```bash
security find-identity -v -p codesigning
```

- [ ] App 专用密码或 API Key（用于 `notarytool`）
- [ ] **凭据绝不能进仓库**：全部通过环境变量或 CI Secrets 传入

### 5.2 签名

- [ ] 从 `package.json` 的 `build.mac` 里删掉 `"identity": null`
- [ ] 构建后验证签名：

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/DoTodo.app
codesign -dv --verbose=4 release/mac-arm64/DoTodo.app
```

- [ ] 确认启用了 hardened runtime（公证的前提）
- [ ] 确认 `appId`（`app.dotodo.desktop`）与 entitlements 一致

### 5.3 公证

```bash
xcrun notarytool submit release/DoTodo-1.0.0-arm64.zip \
  --apple-id "<你的 Apple ID>" --team-id "<TEAMID>" --password "<app 专用密码>" --wait
xcrun stapler staple release/mac-arm64/DoTodo.app
```

- [ ] 公证返回 `status: Accepted`
- [ ] `stapler staple` 成功
- [ ] 在**一台从未运行过这个 app** 的 Mac 上双击打开，不再被 Gatekeeper 拦截
- [ ] `spctl -a -vvv -t install release/mac-arm64/DoTodo.app` 通过

### 5.4 重新打包 DMG

公证是对 `.app` 做的，所以要**在公证之后**重新生成 DMG：

- [ ] DMG 里的 `.app` 是已公证并 staple 过的那一份
- [ ] 打开 DMG，拖拽安装到 Applications 能正常工作
- [ ] 从 DMG 启动的 app 不被拦截

## 6. 发布

- [ ] CI 已配置 macOS 签名所需的 Secrets（证书 base64、密码、Apple ID、Team ID）
- [ ] 推 `v*` tag 后，CI 在 macOS runner 上构建成功
- [ ] 产物与本地构建的结果一致
- [ ] Release 里同时提供 Windows 与 macOS 的安装包
- [ ] 发布说明里写清支持的最低 macOS 版本

**在完成第 5 节之前，不要发布 macOS 产物。** 未签名的 macOS 应用对普通用户来说几乎无法安装。

## 7. 需要改代码才能解决的问题（预判）

以下是目前**已知但未实现**的部分，不要假装它们已经工作：

- [ ] 菜单栏 template image（单色图标）
- [ ] Dock 菜单（`app.dock.setMenu`）
- [ ] `openAsHidden` 在登录项里的行为
- [ ] macOS 的「关闭窗口但不退出」与应用退出语义的细分
- [ ] 关于面板（`app.setAboutPanelOptions`）

## 记录

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 1 平台适配检查 | | |
| 2 构建 | | |
| 3 运行验证 | | |
| 4 Intel / Apple Silicon | | |
| 5 签名与公证 | | |
| 6 发布 | | |
