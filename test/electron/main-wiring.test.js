const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 组合根的接线约束。
 *
 * `src/main.js` 是唯一没法用 Node 单测覆盖的文件：它一被 require 就要求 Electron。
 * 但里面有几条**顺序和成对关系**是硬约束，写错了只有真机跑起来才发现，
 * 而且往往只在某个平台上才发作。这里用文本断言把它们钉住。
 *
 * 这类断言不如行为测试可靠（改个写法就可能失效），所以只保留真正踩过的坑，
 * 不为"写法好看"加规则。
 */

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

test('macOS 的 activate 路径会重新绑定壳层窗口', () => {
  // 关掉窗口再从 Dock 唤起会创建新窗口。少了这一次 bindWindow，
  // 「关闭时隐藏到托盘」在 macOS 上就时灵时不灵。
  const activate = main.match(/app\.on\('activate',[\s\S]*?\n\}\);/);
  assert.ok(activate, '找不到 app.on(\'activate\') 处理器。');
  assert.match(activate[0], /shellController\?\.bindWindow\(\)/);
  assert.ok(
    activate[0].indexOf('createAppWindow()') < activate[0].indexOf('bindWindow()'),
    '必须先建出新窗口，再往它上面绑定'
  );
});

test('退出时三个控制器都被处置', () => {
  const willQuit = main.match(/app\.on\('will-quit',[\s\S]*?\n\}\);/);
  assert.ok(willQuit, '找不到 app.on(\'will-quit\') 处理器。');
  for (const dispose of ['ipcRegistration', 'shellController', 'windowController']) {
    assert.match(willQuit[0], new RegExp(`${dispose}\\?\\.dispose\\(\\)`), `退出时没有处置 ${dispose}`);
  }
});

test('壳层初始化发生在窗口创建之后', () => {
  // bindWindow 需要窗口已经存在；initialize 还会顺便在托盘创建失败时记警告。
  const initialize = main.indexOf('createAppWindow();');
  const shellBoot = main.indexOf('shellController.initialize()');
  assert.ok(initialize > 0 && shellBoot > 0);
  assert.ok(initialize < shellBoot, '窗口要在壳层初始化之前建好');
});

test('IPC 注册晚于状态准备与窗口创建', () => {
  // 早于窗口创建不会立刻出错，但早于引擎创建会让所有 handler 拿到 null。
  const engineCreation = main.indexOf('createDailyTodoEngine(');
  const ipcRegistration = main.indexOf('ipcRegistration = registerIpc(');
  assert.ok(engineCreation > 0 && ipcRegistration > 0);
  assert.ok(engineCreation < ipcRegistration, '引擎必须先于 IPC 注册');
});

test('托盘改设置之后会主动把快照推给界面', () => {
  // 托盘菜单不经过渲染进程。少了这次推送，用户在托盘里切了「置顶」，
  // 设置面板会一直显示旧值，直到别的原因触发一次重绘。
  const shellIntent = main.match(/async function handleShellIntent[\s\S]*?\n\}/);
  assert.ok(shellIntent, '找不到 handleShellIntent。');
  assert.match(shellIntent[0], /broadcastSnapshot\(\)/);
  assert.match(main, /window\.webContents\.send\(SNAPSHOT_CHANNEL/);
});

test('渲染进程会订阅主进程推来的快照', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /window\.dotodo\.onSnapshot\(applySnapshot\)/);
});

test('冒烟模式会汇报壳层启动结果', () => {
  // tools/ui-check.js 靠这一行断言托盘在真实 Electron 里建起来了。
  assert.match(main, /DOTODO_SHELL_BOOT/);
});

test('测试入口下一律不挂桌面层', () => {
  // 冒烟和交互场景会开出真窗口逐个断言。窗口一挂进桌面就脱离了顶层窗口列表，
  // tools/ui-check.js 那几百条断言会全部扑空 —— 而且失败信息完全指不到这里，
  // 只会看起来像"窗口根本没建出来"。
  const composition = main.match(/const desktopLayer = [\s\S]*?:\s*createDesktopLayer\(\);/);
  assert.ok(composition, "找不到桌面层的组装（应该是一个 `const desktopLayer = ...` 的择一表达式）。");
  assert.match(composition[0], /isSmokeTest \|\| driveScript/, '必须由两个测试标记关掉');
  assert.match(composition[0], /createDesktopLayer\(\{ native: null \}\)/, '关掉时给一个空实现，而不是留 null');
});

test('窗口控制器拿到桌面层，并且挂载结果会留下日志', () => {
  const createWindow = main.match(/function createAppWindow\(\)[\s\S]*?\n\}/);
  assert.ok(createWindow, '找不到 createAppWindow。');
  assert.match(createWindow[0], /^\s+desktopLayer,$/m, '窗口控制器需要拿到桌面层');
  // 挂不上是正常降级，但「为什么没贴上」必须能从日志回答，否则是彻底静默的。
  assert.match(createWindow[0], /onDesktopAttachment: \(outcome\) => \{/);
});

test('IPC 拿到桌面适配器，且它只做补焦点这一件事', () => {
  assert.match(main, /desktop: createDesktopAdapter\(\)/);
  assert.match(main, /focus: \(\) => windowController\.focusDesktop\(\)/);
});

test('渲染进程点窗口时会请求补焦点', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  // 挂进桌面之后点它不会有键盘；这一下请求就是唯一的补救入口。
  assert.match(app, /document\.addEventListener\('mousedown',[\s\S]*?\}, true\);/);
  assert.match(app, /window\.dotodo\.requestDesktopFocus\(\)/);
});
