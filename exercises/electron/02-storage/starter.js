const path = require('node:path');

function makeStatePaths(directory) {
  throw new Error('请实现 makeStatePaths');
}

function safeParseJson(text) {
  throw new Error('请实现 safeParseJson');
}

function classifyCandidate(text, validate) {
  throw new Error('请实现 classifyCandidate');
}

function chooseLoadResult(primary, backup) {
  throw new Error('请实现 chooseLoadResult');
}

function serializeState(state) {
  throw new Error('请实现 serializeState');
}

module.exports = {
  makeStatePaths,
  safeParseJson,
  classifyCandidate,
  chooseLoadResult,
  serializeState
};
