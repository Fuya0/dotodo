/*
 * 交互场景运行器。
 *
 * 静态检查（test/renderer/markup.test.js）只能证明「文件内容对得上」，
 * 纯函数测试只能证明「投影算得对」。真正在浏览器里点一下会发生什么，
 * 这两者都证明不了。
 *
 * 这个工具为 test/ui/ 里每个场景做三件事：
 *   1. 建一个隔离的用户数据目录，写入一份演示清单；
 *   2. 启动真实 Electron，让主进程把场景脚本丢进渲染进程执行；
 *   3. 收集场景返回的断言结果，并在结束后截一张图（跑完之后的界面状态）。
 *
 *   npm run ui-check
 *
 * 加 -v / --verbose 会把 Electron 的输出也打出来，排查场景为什么没跑起来时用。
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildDemoState } = require('./capture-window');
const { validateState } = require('../src/domain/state-schema');

const projectDirectory = path.resolve(__dirname, '..');
const electronPath = require('electron');
const scenarioDirectory = path.join(projectDirectory, 'test', 'ui');
const shotDirectory = path.join(projectDirectory, 'shots', 'ui');
const prelude = fs.readFileSync(path.join(scenarioDirectory, '_prelude.js'), 'utf8');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

const SCENARIO_TIMEOUT_MS = 45_000;

function listScenarios() {
  return fs
    .readdirSync(scenarioDirectory)
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
    .sort();
}

function runScenario(name) {
  return new Promise((resolve) => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-ui-'));
    const userData = path.join(workspace, 'userData');
    fs.mkdirSync(userData, { recursive: true });

    // 演示数据必须先过状态校验：非法数据会让应用把它当成"损坏"隔离掉，
    // 场景就会在一个空清单上跑，报出一堆莫名其妙的选择器错误。
    const fixture = buildDemoState();
    const validation = validateState(fixture);
    if (!validation.ok) {
      resolve({ name, error: `演示数据无效：${validation.error}`, checks: [] });
      return;
    }
    fs.writeFileSync(path.join(userData, 'state.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

    const drivePath = path.join(workspace, 'scenario.drive.js');
    fs.writeFileSync(
      drivePath,
      `${prelude}\n\n/* ---- 场景：${name} ---- */\n${fs.readFileSync(path.join(scenarioDirectory, name), 'utf8')}\n`,
      'utf8'
    );

    fs.mkdirSync(shotDirectory, { recursive: true });
    const shotPath = path.join(shotDirectory, name.replace(/\.js$/, '.png'));

    const child = spawn(
      electronPath,
      ['.', '--smoke-test', `--drive=${drivePath}`, `--capture=${shotPath}`, '--capture-backdrop=#2f6fd0'],
      {
        cwd: projectDirectory,
        env: { ...process.env, DOTODO_SMOKE_USER_DATA: userData },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, SCENARIO_TIMEOUT_MS);

    const settle = (outcome) => {
      clearTimeout(timer);
      try {
        fs.rmSync(workspace, { recursive: true, force: true });
      } catch {
        // 临时目录清理失败不影响结果。
      }
      if (verbose) {
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim()) console.error(stderr.trim());
      }
      resolve(outcome);
    };

    child.once('error', (error) => settle({ name, error: `无法启动 Electron：${error.message}`, checks: [] }));
    child.once('close', (code) => {
      if (timedOut) {
        settle({ name, error: `${SCENARIO_TIMEOUT_MS / 1000} 秒内没有结束。`, checks: [] });
        return;
      }
      const match = stdout.match(/DOTODO_DRIVE_RESULT (.*)/);
      if (!match) {
        const hint = (stderr.trim() || stdout.trim() || '没有任何输出').split('\n').slice(-3).join(' / ');
        settle({ name, error: `没有收到场景结果（退出码 ${code}）：${hint}`, checks: [] });
        return;
      }
      let checks;
      try {
        checks = JSON.parse(match[1]);
      } catch (error) {
        settle({ name, error: `场景返回值不是合法 JSON：${error.message}`, checks: [] });
        return;
      }
      if (!Array.isArray(checks)) {
        settle({ name, error: '场景必须 return 一个断言数组。', checks: [] });
        return;
      }
      settle({ name, error: null, checks, shot: shotPath });
    });
  });
}

async function main() {
  const scenarios = listScenarios();
  if (scenarios.length === 0) {
    console.error('test/ui/ 下没有找到任何场景文件。');
    process.exitCode = 1;
    return;
  }

  console.log(`DoTodo 交互场景：${scenarios.length} 个\n`);

  let passed = 0;
  let failed = 0;
  const broken = [];

  for (const name of scenarios) {
    const outcome = await runScenario(name);
    console.log(`── ${name}`);

    if (outcome.error) {
      broken.push(name);
      console.log(`  ✗ 场景没有跑完：${outcome.error}\n`);
      continue;
    }

    for (const item of outcome.checks) {
      if (item.passed) {
        passed += 1;
        console.log(`  ✓ ${item.name}`);
      } else {
        failed += 1;
        console.log(`  ✗ ${item.name}${item.detail === null ? '' : `  → 实际：${item.detail}`}`);
      }
    }
    console.log(`  （界面截图：${path.relative(projectDirectory, outcome.shot)}）\n`);
  }

  console.log('─'.repeat(60));
  console.log(`断言：${passed} 通过 / ${failed} 失败${broken.length ? ` / ${broken.length} 个场景未跑完` : ''}`);

  if (failed > 0 || broken.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('✓ 全部交互场景通过。');
  }
}

main();
