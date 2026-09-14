/*
 * 截图工具：启动真实 Electron，把渲染进程画出来的界面存成 PNG。
 *
 * 为什么要它：透明窗口、玻璃透明度、文字对比度这些事，Node 单元测试一条都测不到，
 * 只能真的把界面画出来看。这个脚本用隔离的用户数据目录 + 一份演示数据启动应用，
 * 让主进程执行 capturePage() 落盘，然后退出。
 *
 *   node tools/capture-window.js --out=shots/today.png --backdrop=#2f6fd0
 *
 * --backdrop 会先给页面根元素铺一个纯色底再截图。因为窗口本身是透明的，
 * 不铺底的话截出来只有半透明的暗色像素，看不出「压在亮壁纸上还能不能读」。
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { formatLocalInstant } = require('../src/electron/local-time');

const projectDirectory = path.resolve(__dirname, '..');
const electronPath = require('electron');

function readArgument(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const offset = formatLocalInstant().slice(-6);

function localDate(daysFromToday) {
  const now = new Date();
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday);
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${shifted.getFullYear()}-${month}-${day}`;
}

function instant(date, time) {
  return `${date}T${time}${offset}`;
}

let sequence = 0;
function task(text, { completed = false, at = '08:00:00.000' } = {}) {
  sequence += 1;
  return {
    id: `demo-${sequence}`,
    text,
    completed,
    createdAt: instant(localDate(0), at),
    // 完成时间固定晚于所有 createdAt，否则状态校验会以「完成时间早于创建时间」拒绝整份数据。
    completedAt: completed ? instant(localDate(0), '10:30:00.000') : null,
    continuedFromTaskId: null,
    continuedFromDate: null,
    continuedToTaskId: null,
    continuedToDate: null,
    hasBeenContinued: false
  };
}

function buildDemoState() {
  const today = localDate(0);
  const yesterday = localDate(-1);
  return {
    schemaVersion: 1,
    activeDay: {
      date: today,
      closedAt: null,
      tasks: [
        task('今天下午一点半开会'),
        task('每月八月初八乐乐生日提醒'),
        task('今天20号了，花呗准时还款提醒'),
        task('一个季度过去了，该收房租了'),
        task('每周五上午 10 点开会'),
        task('月度工作计划4：看完12本专业书籍', { completed: true }),
        task('每月最后一个工作日开会'),
        task('工作日本月第一天提交上月工作总结'),
        task('结婚纪念日提醒')
      ]
    },
    history: [
      {
        date: yesterday,
        closedAt: instant(yesterday, '23:59:00.000'),
        tasks: [
          task('整理上周会议纪要', { completed: true, at: '09:20:00.000' }),
          task('给客户回邮件'),
          task('预约体检', { completed: true, at: '07:30:00.000' })
        ]
      }
    ],
    settings: {
      backgroundOpacity: 0.82,
      windowMode: 'topmost',
      closeToTray: true,
      launchAtLogin: false
    },
    windowBounds: { width: 390, height: 640 }
  };
}

module.exports = { buildDemoState, localDate, instant };

if (require.main !== module) {
  return;
}

const outputPath = path.resolve(readArgument('out', path.join(projectDirectory, 'shots', 'today.png')));
const backdrop = readArgument('backdrop', '#2f6fd0');
const page = readArgument('page', 'today');
// 默认跑源码（electron .）；传 --executable 可以截打包后的真实产物，
// 用来验证 asar 里的资源路径（托盘图标、renderer 页面）在分发形态下依然能解析。
const executable = readArgument('executable', null);
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-shot-'));

// 演示数据必须先过状态校验。否则应用会把整份状态当成"损坏"移到 recovery，
// 截图里只会看到一个巨大的红色警告条——排查半天才发现是截图脚本自己的锅。
const demoState = buildDemoState();
const demoValidation = require('../src/domain/state-schema').validateState(demoState);
if (!demoValidation.ok) {
  console.error(`演示数据无效：${demoValidation.error}`);
  process.exit(1);
}

fs.mkdirSync(userDataDirectory, { recursive: true });
fs.writeFileSync(
  path.join(userDataDirectory, 'state.json'),
  `${JSON.stringify(demoState, null, 2)}\n`,
  'utf8'
);

let sawCapture = false;
let settled = false;

const child = spawn(
  executable || electronPath,
  [
    // 打包后的可执行文件不需要（也不接受）项目目录参数，它自己就是应用。
    ...(executable ? [] : ['.']),
    '--smoke-test',
    `--capture=${outputPath}`,
    `--capture-backdrop=${backdrop}`,
    ...(page === 'today' ? [] : [`--capture-page=${page}`])
  ],
  {
    cwd: projectDirectory,
    env: { ...process.env, DOTODO_SMOKE_USER_DATA: userDataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
);

function forward(stream, destination) {
  stream.on('data', (chunk) => {
    const output = chunk.toString();
    if (output.includes('DOTODO_CAPTURE_WRITTEN')) sawCapture = true;
    destination.write(chunk);
  });
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

const timeout = setTimeout(() => finish(1, '截图超时（20 秒）。'), 20_000);

child.once('error', (error) => finish(1, `无法启动 Electron：${error.message}`));
child.once('close', (code) => {
  if (settled) return;
  if (code !== 0 || !sawCapture) {
    finish(1, `截图失败，退出码 ${code}。`);
    return;
  }
  finish(0, null);
});

function finish(code, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (message) console.error(message);
  try {
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  } catch {
    // 临时目录清理失败不影响截图结果。
  }
  if (code === 0) {
    console.log(`截图已写入 ${outputPath}`);
  }
  process.exitCode = code;
}
