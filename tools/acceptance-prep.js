#!/usr/bin/env node
'use strict';

// 为人工验收准备一份隔离的数据，并打印启动命令。
//
// 为什么不直接对着你的真实清单验收：验收要检查的是"删一条再撤销""历史里的未完成任务
// 能延续到今天"这类**具体行为**，需要一份内容已知的数据。改动真实清单既没必要也有风险。
//
// 所以这里造一份数据放进临时目录，用 Electron 自带的 `--user-data-dir` 开关让应用去读它。
// `%APPDATA%\dotodo` 一个字都不会动 —— 验收跑完，你的清单还是原样。
//
// 每次运行都重建，保证验收从同一个已知状态开始。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildDemoState } = require('./capture-window.js');
const { validateState } = require('../src/domain/state-schema.js');

const DEFAULT_DIRECTORY_NAME = 'dotodo-acceptance';

/**
 * 这个工具**自己写的**文件。清数据时只动它们。
 *
 * 目录里还有 `chromium/` 和 Electron 的 `lockfile`，那是应用的东西：
 * 应用还开着的时候它们正被锁着，一起删就会以 EBUSY 失败。
 */
const OWNED_DATA_FILE = /^(state\.json|state\.backup\.json|recovery-.*\.json)$/;

function defaultDataDirectory() {
  return path.join(os.tmpdir(), DEFAULT_DIRECTORY_NAME);
}

/**
 * 把验收用的数据写进一个临时目录。返回 { ok, dataDirectory, stateFile, state }。
 * 写盘前先过一遍 schema 校验：宁可在这里失败，也不要让应用启动后才发现数据有问题。
 */
function prepareAcceptanceData(options = {}) {
  const dataDirectory = options.dataDirectory || defaultDataDirectory();
  const state = buildDemoState();

  const validation = validateState(state);
  if (!validation.ok) {
    return { ok: false, error: validation.error, dataDirectory };
  }

  const stateFile = path.join(dataDirectory, 'state.json');
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    clearDataFiles(dataDirectory);
    fs.writeFileSync(stateFile, `${JSON.stringify(validation.state, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, error: describeWriteFailure(error, dataDirectory), dataDirectory };
  }

  return { ok: true, dataDirectory, stateFile, state: validation.state };
}

/**
 * 只清这个工具自己写的那几个文件，别的一律不碰。
 *
 * 以前是整个目录一起删。应用还开着的时候 `chromium/` 和 Electron 的 `lockfile`
 * 正被它锁着，删到一半就以 EBUSY 失败，用户看到的是一串 errno 堆栈 ——
 * 而这本来只是"顺手清一下"的事。
 */
function clearDataFiles(dataDirectory) {
  for (const name of fs.readdirSync(dataDirectory)) {
    if (!OWNED_DATA_FILE.test(name)) continue;
    fs.rmSync(path.join(dataDirectory, name), { force: true });
  }
}

function describeWriteFailure(error, dataDirectory) {
  if (error && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
    return `${dataDirectory} 里有文件正被占用。应用是不是还开着？` +
      '先从托盘菜单选「退出」，再跑一次。';
  }
  return error instanceof Error ? error.message : String(error);
}

function main() {
  const prepared = prepareAcceptanceData();
  if (!prepared.ok) {
    // 可能是数据不合法，也可能是目录被占用 —— error 里已经写成一句人话了。
    console.error(`验收数据没能准备好：${prepared.error}`);
    return 1;
  }

  const continuable = prepared.state.history
    .flatMap((day) => day.tasks)
    .filter((task) => !task.completed && !task.hasBeenContinued).length;

  console.log('验收数据已准备好（你真实的清单不会被碰）：');
  console.log(`  ${prepared.stateFile}`);
  console.log(`  今天 ${prepared.state.activeDay.tasks.length} 条任务，其中 1 条已完成`);
  console.log(`  历史 ${prepared.state.history.length} 天，其中 ${continuable} 条未完成、可以延续到今天`);
  console.log('');
  console.log('启动（只开这一个窗口，数据来自上面那个目录）：');
  console.log('');
  console.log(`  npm start -- --user-data-dir="${prepared.dataDirectory}"`);
  console.log('');
  console.log('然后对照 docs/testing/acceptance-quick.md 逐条看。');
  console.log('看完请从托盘菜单选「退出」——窗口的关闭按钮只是隐藏，不会退出应用。');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { DEFAULT_DIRECTORY_NAME, defaultDataDirectory, main, prepareAcceptanceData };
