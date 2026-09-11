# DoTodo

一个轻量、安静、可以悬浮在桌面上的待办清单，支持 Windows 与 macOS。

## 功能

- 无边框悬浮小窗，可拖动、缩放、最小化
- 透明度可调（55%–100%），可随时切换“始终置顶”
- 添加、完成、双击编辑、删除与筛选待办
- 自动保存到本机，不需要账号或网络
- 跟随系统浅色/深色主题
- 可选开机启动
- 键盘快捷键：`Ctrl/⌘ + N` 聚焦到输入框

## 本地运行

需要 Node.js 22.12 或更新版本。

```bash
npm install
npm start
```

## 测试

```bash
npm test
```

## 打包

Windows（在 Windows 上执行）：

```bash
npm run dist:win
```

macOS（需要在 macOS 上执行）：

```bash
npm run dist:mac
```

生成物位于 `release/`。面向公众分发时，建议分别配置 Windows 代码签名与 Apple Developer ID 签名/公证。

## 自动发布

推送形如 `v1.0.0` 的 Git 标签后，GitHub Actions 会分别在 Windows 与 macOS 构建安装包，并附加到 GitHub Release。未配置签名证书时仍可构建，但系统会显示“未知发布者”或未公证提示。

## 数据位置

DoTodo 使用 Electron 的应用数据目录保存 `state.json`：

- Windows：`%APPDATA%/DoTodo/state.json`
- macOS：`~/Library/Application Support/DoTodo/state.json`

## License

[MIT](LICENSE)
