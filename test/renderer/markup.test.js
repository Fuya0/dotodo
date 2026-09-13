/**
 * 渲染层的静态约束测试。
 *
 * 渲染进程是唯一不能靠 Node 单测覆盖的运行环境（它需要真实 Chromium）。这些断言
 * 用文本检查代替启动窗口，专门拦住最容易被手误写坏、又只会在运行时才报错的地方：
 * 选择器与 HTML 的 id 对不上、渲染脚本偷偷 require 了 Node、页面里混进内联脚本、
 * 玻璃背景没有走 --surface-opacity。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDirectory = path.join(__dirname, '..', '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(rendererDirectory, 'app.js'), 'utf8');
const viewModel = fs.readFileSync(path.join(rendererDirectory, 'view-model.js'), 'utf8');
const styles = fs.readFileSync(path.join(rendererDirectory, 'styles.css'), 'utf8');

function matchAll(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/** 注释里可以自由地提到 require/process，所以做源码级检查前要先去掉注释。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('index.html 里声明的每个 id 都唯一', () => {
  const ids = matchAll(html, /\sid="([^"]+)"/g);
  assert.ok(ids.length > 0, '页面应该至少声明一个 id。');
  assert.equal(new Set(ids).size, ids.length, `存在重复 id：${ids.join(', ')}`);
});

test('app.js 查询到的每个 id 都真的存在于 index.html', () => {
  const declared = new Set(matchAll(html, /\sid="([^"]+)"/g));
  const queried = matchAll(app, /querySelector\('#([^']+)'\)/g);
  assert.ok(queried.length > 0, 'app.js 应该查询界面元素。');
  const missing = queried.filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `app.js 查询了不存在的 id：${missing.join(', ')}`);
});

test('渲染脚本不触碰 Node 与 Electron', () => {
  for (const [name, source] of [['app.js', app], ['view-model.js', viewModel]]) {
    const code = stripComments(source);
    assert.doesNotMatch(code, /\brequire\s*\(/, `${name} 不应调用 require()`);
    assert.doesNotMatch(code, /\bprocess\s*\./, `${name} 不应访问 process`);
    assert.doesNotMatch(code, /ipcRenderer/, `${name} 不应直接使用 ipcRenderer`);
    assert.doesNotMatch(code, /\bnodeIntegration\b/, `${name} 不应配置窗口安全选项`);
  }
});

test('渲染脚本只调用这一阶段开放的主进程接口', () => {
  const calls = matchAll(app, /window\.dotodo\.([A-Za-z]+)\(/g);
  assert.ok(calls.length > 0, 'app.js 应该调用 window.dotodo。');
  const allowed = new Set([
    'getSnapshot', 'getStatus', 'addTask', 'editTask', 'toggleTask', 'deleteTodayTask', 'undo',
    'reorderTask', 'deleteHistoryTask', 'continueTask',
    'setBackgroundOpacity', 'setWindowMode', 'setCloseToTray', 'setLaunchAtLogin',
    'minimizeWindow', 'closeWindow'
  ]);
  const unexpected = calls.filter((name) => !allowed.has(name));
  assert.deepEqual(unexpected, [], `界面调用了尚未开放的接口：${unexpected.join(', ')}`);
});

test('用户文本只通过 textContent 写入，innerHTML 仅用于固定图标', () => {
  assert.match(app, /textContent = row\.text/);
  const unsafe = [...app.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => !['CHECK_ICON', 'DELETE_ICON', 'DRAG_ICON'].includes(value));
  assert.deepEqual(unsafe, [], `innerHTML 只允许写入图标常量：${unsafe.join(', ')}`);
});

test('底部标签与页面容器一一对应', () => {
  const pages = matchAll(html, /data-page="([^"]+)"/g);
  assert.deepEqual(pages, ['today', 'history']);
  for (const page of pages) {
    assert.ok(html.includes(`id="${page}Page"`), `缺少 id="${page}Page" 的页面容器。`);
  }
  assert.match(app, /dom\.todayPage\.hidden = isHistory/);
  assert.match(app, /dom\.historyPage\.hidden = !isHistory/);
});

test('排序同时提供指针拖拽和键盘入口', () => {
  assert.match(app, /addEventListener\('pointerdown'/);
  assert.match(app, /resolveDropIndex\(midpoints, event\.clientY\)/);
  assert.match(app, /window\.dotodo\.reorderTask/);
  assert.match(app, /event\.altKey && \(event\.key === 'ArrowDown'/);
  assert.doesNotMatch(app, /\bdragstart\b/);
});

test('页面没有内联脚本，并且先加载投影再加载界面', () => {
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  assert.deepEqual(inlineScripts, [], 'CSP 只允许 self，页面不能有内联脚本体。');

  const order = matchAll(html, /<script src="([^"]+)"><\/script>/g);
  assert.deepEqual(order, ['view-model.js', 'app.js']);
});

test('view-model.js 同时支持 Node 测试与浏览器全局', () => {
  assert.match(viewModel, /if \(typeof module !== 'undefined' && module\.exports\)/);
  assert.match(viewModel, /^function deriveTodayView\(/m);
});

test('玻璃透明度只作用在背景层，内容层没有整体透明', () => {
  assert.match(styles, /\.app-shell::before\s*\{[\s\S]*?opacity:\s*var\(--surface-opacity\)/);
  assert.match(app, /setProperty\('--surface-opacity'/);
  assert.doesNotMatch(app, /setOpacity/);
});

test('撤销条自带六秒倒计时动画', () => {
  assert.match(html, /id="undoProgress"/);
  assert.match(styles, /@keyframes undo-countdown/);
  assert.match(styles, /animation:\s*undo-countdown 6s linear forwards/);
  assert.match(app, /UNDO_VISIBLE_MS = 6000/);
});

test('页面可以被拖动，控件区不参与拖动', () => {
  assert.match(styles, /-webkit-app-region:\s*drag/);
  assert.match(styles, /-webkit-app-region:\s*no-drag/);
});

test('styles.css 的大括号成对闭合', () => {
  const opened = (styles.match(/\{/g) ?? []).length;
  const closed = (styles.match(/\}/g) ?? []).length;
  assert.equal(opened, closed, 'CSS 大括号数量不一致，样式文件多半被写坏了。');
});

test('index.html 的常用标签成对闭合', () => {
  for (const tag of ['main', 'header', 'nav', 'form', 'section', 'div', 'span', 'button', 'svg', 'p', 'h1', 'h2']) {
    const opened = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
    const closed = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    assert.equal(opened, closed, `<${tag}> 的开合数量不一致。`);
  }
});
