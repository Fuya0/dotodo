/*
 * 交互场景的公共前置代码。
 *
 * 每个场景文件都会被拼在这段代码后面，作为一个 async 函数体丢进真实渲染进程执行，
 * 所以这里定义的变量和函数场景里可以直接用（它们在同一个作用域里）。
 *
 * 场景必须 `return results;`，runner 会把数组打成一张通过/失败表。
 */

const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const text = (selector) => q(selector)?.textContent?.trim() ?? null;
const rows = () => qa('.todo-row');
const rowTexts = () => rows().map((row) => row.querySelector('.todo-text')?.textContent ?? '');

/** 事件驱动的界面是异步的，断言一律等条件成立，而不是等固定的毫秒数。 */
async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (predicate()) return true;
    } catch {
      // 元素还没出现时 predicate 可能抛错，当作"还没到"。
    }
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail: passed ? null : (detail ?? null) });
}

async function expect(name, predicate, detail) {
  const ok = await waitFor(predicate);
  check(name, ok, typeof detail === 'function' ? detail : detail ?? null);
}

/** 在某个元素上按一个键；事件要冒泡才能被列表上的委托监听器收到。 */
function press(target, key, options = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}
