const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cloneState, validateState } = require('../domain/state-schema');

class JsonStateStore {
  constructor(directory, {
    copyFileSync = fs.copyFileSync,
    syncDirectory: syncDirectoryOperation = syncDirectory
  } = {}) {
    if (typeof directory !== 'string' || directory.trim() === '') {
      throw new TypeError('状态目录必须是非空路径。');
    }

    this.directory = path.resolve(directory);
    this.paths = Object.freeze({
      primary: path.join(this.directory, 'state.json'),
      backup: path.join(this.directory, 'state.backup.json'),
      temporary: path.join(this.directory, 'state.tmp.json')
    });
    this.writable = true;
    this.recoverySequence = 0;
    // 恢复文件路径累积保留；以源路径和内容摘要去重。
    // 同一份损坏内容被 load/save 重复发现时只复制一次，后续不同的损坏内容仍须保留。
    this.preservedFiles = [];
    this.preservedSources = new Set();
    this.copyFileSync = copyFileSync;
    this.syncDirectory = syncDirectoryOperation;
  }

  getPaths() {
    return { ...this.paths };
  }

  /** 到目前为止保留过的损坏文件路径。主进程用它把"证据在哪"如实告诉用户。 */
  getPreservedCorruptFiles() {
    return [...this.preservedFiles];
  }

  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    const preservedCorruptFiles = [];
    const primary = this.#readCandidate(this.paths.primary);

    if (primary.kind === 'valid') {
      const backup = this.#readCandidate(this.paths.backup);
      if (backup.kind === 'corrupt') {
        this.#preserveCorruptFile(this.paths.backup, 'backup', preservedCorruptFiles);
      }
      const warning = backup.kind === 'corrupt'
        ? this.writable
          ? '备份状态文件已损坏，原文件已单独保留。'
          : '备份状态文件已损坏且无法安全保留，已停止写入。'
        : null;
      return loadResult(primary.state, warning, preservedCorruptFiles, this.writable);
    }

    if (primary.kind === 'corrupt') {
      this.#preserveCorruptFile(this.paths.primary, 'primary', preservedCorruptFiles);
    }

    const backup = this.#readCandidate(this.paths.backup);
    if (backup.kind === 'valid') {
      const warning = primary.kind === 'corrupt'
        ? this.writable
          ? '当前状态文件已损坏，已保留原文件并从备份恢复。'
          : '已从备份恢复，但损坏的主文件无法安全保留，存储已停止写入。'
        : '当前状态文件不存在，已从备份恢复。';
      return loadResult(backup.state, warning, preservedCorruptFiles, this.writable);
    }

    if (backup.kind === 'corrupt') {
      this.#preserveCorruptFile(this.paths.backup, 'backup', preservedCorruptFiles);
    }

    const warning = primary.kind === 'missing' && backup.kind === 'missing'
      ? null
      : this.writable
        ? '状态文件和备份均损坏，原文件已保留，请创建新的清单。'
        : '损坏文件无法安全保留，已停止写入以避免覆盖可恢复数据。';
    return loadResult(null, warning, preservedCorruptFiles, this.writable);
  }

  save(state) {
    this.#assertWritable();
    const validState = assertValidState(state);
    fs.mkdirSync(this.directory, { recursive: true });

    const current = this.#readCandidate(this.paths.primary);
    if (current.kind === 'corrupt') {
      this.#preserveCorruptFile(this.paths.primary, 'primary', []);
      this.#assertWritable();
    }
    if (current.kind === 'valid') {
      const existingBackup = this.#readCandidate(this.paths.backup);
      if (existingBackup.kind === 'corrupt') {
        this.#preserveCorruptFile(this.paths.backup, 'backup', []);
        this.#assertWritable();
      }
      this.#writeJsonAtomically(this.paths.backup, current.state, 'backup');
    }

    this.#writeJsonAtomically(this.paths.primary, validState, 'primary');
    return cloneState(validState);
  }

  importFrom(sourcePath) {
    const imported = this.#readRequiredState(sourcePath);
    this.save(imported);
    return cloneState(imported);
  }

  exportTo(destinationPath, state) {
    const validState = assertValidState(state);
    const absoluteDestination = path.resolve(destinationPath);
    fs.mkdirSync(path.dirname(absoluteDestination), { recursive: true });
    this.#writeJsonAtomically(absoluteDestination, validState, 'export');
    return absoluteDestination;
  }

  #assertWritable() {
    if (!this.writable) {
      throw new Error('状态存储已停止写入：损坏文件尚未被安全保留。');
    }
  }

  #readRequiredState(filePath) {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      throw new Error(`无法读取导入文件：${error.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('导入文件不是有效的 JSON 状态。');
    }
    return assertValidState(parsed);
  }

  #readCandidate(filePath) {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'corrupt', error };
    }

    try {
      const validation = validateState(JSON.parse(text));
      return validation.ok
        ? { kind: 'valid', state: validation.state }
        : { kind: 'corrupt', error: new Error(validation.error) };
    } catch (error) {
      return { kind: 'corrupt', error };
    }
  }

  #preserveCorruptFile(sourcePath, label, preservedFiles) {
    const recoveryPath = this.#nextRecoveryPath(label);
    try {
      const digest = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
      const sourceKey = `${sourcePath}\0${digest}`;
      if (this.preservedSources.has(sourceKey)) return;
      this.copyFileSync(sourcePath, recoveryPath, fs.constants.COPYFILE_EXCL);
      syncFile(recoveryPath);
      this.syncDirectory(this.directory);
      this.preservedSources.add(sourceKey);
      this.preservedFiles.push(recoveryPath);
      preservedFiles.push(recoveryPath);
    } catch {
      this.writable = false;
    }
  }

  #nextRecoveryPath(label) {
    this.recoverySequence += 1;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(
      this.directory,
      `recovery-${label}-${timestamp}-${process.pid}-${this.recoverySequence}.json`
    );
  }

  #writeJsonAtomically(destinationPath, state, purpose) {
    const temporaryPath = destinationPath === this.paths.primary
      ? this.paths.temporary
      : `${destinationPath}.${purpose}.${process.pid}.tmp`;
    const json = `${JSON.stringify(state, null, 2)}\n`;

    try {
      writeAndSync(temporaryPath, json);
      fs.renameSync(temporaryPath, destinationPath);
      this.syncDirectory(path.dirname(destinationPath));
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // 保留最初的写入错误；临时文件可在下次启动时清理。
      }
      throw new Error(`无法安全写入状态文件：${error.message}`);
    }
  }
}

function assertValidState(state) {
  const validation = validateState(state);
  if (!validation.ok) throw new TypeError(`状态无效：${validation.error}`);
  return validation.state;
}

function writeAndSync(filePath, text) {
  const descriptor = fs.openSync(filePath, 'w');
  try {
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncFile(filePath) {
  // Windows requires a writable handle for FlushFileBuffers (fsync).
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    const unsupportedCodes = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);
    if (!unsupportedCodes.has(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function loadResult(state, warning, preservedCorruptFiles, writable) {
  return {
    state: state ? cloneState(state) : null,
    warning,
    preservedCorruptFiles: [...preservedCorruptFiles],
    writable
  };
}

module.exports = { JsonStateStore };
