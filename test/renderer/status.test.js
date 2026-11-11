const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('an older status response cannot overwrite the latest runtime warning', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const refresh = source.match(/async function refreshStatus\(\) \{[\s\S]*?\n\}/)[0];
  const pending = [];
  const warning = { hidden: true, textContent: '' };
  const context = vm.createContext({
    dom: { warning },
    window: { dotodo: { getStatus: () => new Promise(resolve => pending.push(resolve)) } }
  });
  vm.runInContext(`let statusRequestRevision = 0; ${refresh}`, context);
  const older = vm.runInContext('refreshStatus()', context);
  const newer = vm.runInContext('refreshStatus()', context);
  pending[1]({ warnings: ['最新保存失败'] });
  await newer;
  pending[0]({ warnings: [] });
  await older;
  assert.equal(warning.textContent, '最新保存失败');
  assert.equal(warning.hidden, false);
});
