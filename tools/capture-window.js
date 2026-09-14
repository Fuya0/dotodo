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

/**
 * 本次进程的"现在"，演示数据里的时刻全部以它为基准。
 *
 * 要同时满足两条互相拉扯的要求：
 *
 *   - 时刻**不能写死钟点**。凌晨跑验收时"当天 08:00"还在未来，用户点一下完成就会
 *     撞上「完成时间不能早于创建时间」，整份状态被 schema 拒掉（踩过，见 todayTask）。
 *   - 同一进程里调两次 `buildDemoState()` 必须**完全一样**。验收准备跑两遍要得到
 *     同一份数据，否则第二遍会继承上一遍的改动，"每次都从同一个已知状态开始"就没了。
 *
 * 把"进程启动那一刻"固定下来当基准，两条都满足。
 */
const referenceNow = new Date();

function dateOf(when) {
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

function localDate(daysFromToday) {
  const now = new Date();
  return dateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday));
}

function instant(date, time) {
  return `${date}T${time}${offset}`;
}

/** 今天某个"进度点"对应的时刻：0 = 今天零点，1 = 基准时刻。 */
function earlierToday(progress) {
  const midnight = new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate());
  const when = new Date(midnight.getTime() + (referenceNow.getTime() - midnight.getTime()) * progress);
  return instant(dateOf(when), clockTime(when));
}

function clockTime(when) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}.${pad(when.getMilliseconds(), 3)}`;
}

let sequence = 0;

function makeTask(text, createdAt, completedAt) {
  sequence += 1;
  return {
    id: `demo-${sequence}`,
    text,
    completed: completedAt !== null,
    createdAt,
    completedAt,
    continuedFromTaskId: null,
    continuedFromDate: null,
    continuedToTaskId: null,
    continuedToDate: null,
    hasBeenContinued: false
  };
}

/**
 * 今天的一条演示任务。
 *
 * **时刻必须由"现在"推出来，不能写死钟点。** 这里踩过一次：以前 createdAt 固定成
 * 当天 08:00、completedAt 固定成 10:30，凌晨跑验收时两个时刻都还在未来 —— 用户点一下
 * 「完成」，写进去的"现在"反而早于创建时间，整份状态被 schema 以「完成时间不能早于
 * 创建时间」拒掉，界面上弹出「数据暂时只保存在内存中」，而他什么都没做错。
 *
 * `progress` 取 0~1，是"从今天零点到现在"的进度，所以生成的时刻既落在今天、又已经过去。
 */
function todayTask(text, progress, completedProgress = null) {
  return makeTask(
    text,
    earlierToday(progress),
    completedProgress === null ? null : earlierToday(completedProgress)
  );
}

/** 历史里的一条：日期在过去，钟点写死也永远是过去。 */
function historyTask(day, text, at, completedAt = null) {
  return makeTask(
    text,
    instant(day, at),
    completedAt === null ? null : instant(day, completedAt)
  );
}

function buildDemoState() {
  // 计数器每次从 0 开始，这个函数才是可复现的：同一进程里调用两次，
  // 拿到的 id 也完全一样。之前它是模块级的、只增不减，第二次调用会接着
  // 往下排号，于是"同一份演示数据"其实每次不同 —— 验收准备那里就撞上了。
  sequence = 0;
  const today = localDate(0);
  const yesterday = localDate(-1);
  return {
    schemaVersion: 1,
    activeDay: {
      date: today,
      closedAt: null,
      tasks: [
        todayTask('今天下午一点半开会', 0.10),
        todayTask('每月八月初八乐乐生日提醒', 0.18),
        todayTask('今天20号了，花呗准时还款提醒', 0.26),
        todayTask('一个季度过去了，该收房租了', 0.34),
        todayTask('每周五上午 10 点开会', 0.42),
        todayTask('月度工作计划4：看完12本专业书籍', 0.50, 0.62),
        todayTask('每月最后一个工作日开会', 0.58),
        todayTask('工作日本月第一天提交上月工作总结', 0.66),
        todayTask('结婚纪念日提醒', 0.74)
      ]
    },
    history: [
      {
        date: yesterday,
        closedAt: instant(yesterday, '23:59:00.000'),
        tasks: [
          historyTask(yesterday, '整理上周会议纪要', '09:20:00.000', '11:05:00.000'),
          historyTask(yesterday, '给客户回邮件', '10:40:00.000'),
          historyTask(yesterday, '预约体检', '07:30:00.000', '08:15:00.000')
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

module.exports = { buildDemoState, earlierToday, localDate, instant };

if (require.main !== module) {
  return;
}

const outputPath = path.resolve(readArgument('out', path.join(projectDirectory, 'shots', 'today.png')));
const backdrop = readArgument('backdrop', '#2f6fd0');
const page = readArgument('page', 'today');
// 默认跑源码（electron .）；传 --executable 可以截打包后的真实产物，
// 用来验证 asar 里的资源路径（托盘图标、renderer 页面）在分发形态下依然能解析。
const executable = readArgument('executable', null);
// 传 --drive=<脚本> 可以先在渲染进程里做一串操作再截图。
// 截图是**做完之后**的状态，所以想看「设置面板打开的样子」就让它保持打开。
const driveSource = readArgument('drive', null);
// 传 --size=720x900 用别的窗口尺寸截图。应用可缩放到 330–720 × 420–900，
// 布局问题往往只在宽窗口下才看得出来。
const size = readArgument('size', null);
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-shot-'));

// 演示数据必须先过状态校验。否则应用会把整份状态当成"损坏"移到 recovery，
// 截图里只会看到一个巨大的红色警告条——排查半天才发现是截图脚本自己的锅。
const demoState = buildDemoState();
if (size) {
  const [width, height] = size.split('x').map(Number);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    demoState.windowBounds = { width, height };
  } else {
    console.error(`--size 应该写成 720x900 这样，收到的是 ${size}`);
    process.exit(1);
  }
}
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
    ...(page === 'today' ? [] : [`--capture-page=${page}`]),
    ...(driveSource ? [`--drive=${path.resolve(driveSource)}`] : [])
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
