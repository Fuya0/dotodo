const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectDirectory = path.resolve(__dirname, '..');
const electronPath = require('electron');
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-smoke-'));
let sawReady = false;
let finished = false;
let timedOut = false;
let forceFinishTimer = null;

let child;
try {
  child = spawn(electronPath, ['.', '--smoke-test'], {
    cwd: projectDirectory,
    env: { ...process.env, DOTODO_SMOKE_USER_DATA: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
} catch (error) {
  console.error(`无法启动 Electron：${error.message}`);
  cleanupAndExit(1, 0);
}

function forward(stream, destination) {
  stream.on('data', (chunk) => {
    const output = chunk.toString();
    if (output.includes('DOTODO_SMOKE_READY')) sawReady = true;
    destination.write(chunk);
  });
}

let timeout = null;

if (child) {
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  timeout = setTimeout(() => {
    if (finished) return;
    timedOut = true;
    child.kill();
    forceFinishTimer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGKILL');
      finish(1, 'Electron smoke 超时且进程未在终止请求后退出。');
    }, 2_000);
  }, 15_000);
  child.once('error', (error) => finish(1, `无法启动 Electron：${error.message}`));
  child.once('close', (code) => {
    const succeeded = !timedOut && code === 0 && sawReady;
    const message = timedOut
      ? 'Electron smoke 超过 15 秒未完成。'
      : succeeded ? null : `Electron smoke 失败，退出码 ${code}。`;
    finish(succeeded ? 0 : 1, message);
  });
}

function finish(code, message) {
  if (finished) return;
  finished = true;
  if (timeout !== null) clearTimeout(timeout);
  if (forceFinishTimer !== null) clearTimeout(forceFinishTimer);
  if (message) console.error(message);
  cleanupAndExit(code, 0);
}

function cleanupAndExit(code, attempt) {
  try {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    process.exitCode = code;
  } catch (error) {
    if (attempt < 4) {
      setTimeout(() => cleanupAndExit(code, attempt + 1), 100);
      return;
    }
    console.error(`无法清理 smoke 临时目录 ${dataDirectory}: ${error.message}`);
    process.exitCode = 1;
  }
}
