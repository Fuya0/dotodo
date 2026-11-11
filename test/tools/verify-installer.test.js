const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Parse without dot-sourcing: no installer, registry, shortcut or application code runs.
function runFunctions(body) {
  const setup = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
$results = New-Object System.Collections.Generic.List[object]
$script:failures = @()
$script:uninstallAttempted = $false
$script:installationStarted = $false
$productName = 'DoTodo'
$KeepInstalled = $false
# Any accidental call outside the intended seam fails without touching the host.
function Start-Process { throw 'unexpected process launch' }
function Stop-Process { throw 'unexpected process termination' }
function Remove-Item { throw 'unexpected deletion' }
function Get-ItemProperty { throw 'unexpected registry read' }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(setup + body + '\nexit 0', 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const repositoryRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repositoryRoot, 'tools', 'verify-installer.ps1');
const bytes = fs.readFileSync(scriptPath);
const text = bytes.toString('utf8');

function codeLines() {
  // 注释里会解释「为什么不能用某种写法」，那些行不该被当成违规。
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line.length > 0 && !entry.line.startsWith('#'));
}

test('步骤失败会记录失败并抛出，阻止下一步', () => {
  runFunctions(`
$script:nextRan = $false
try {
  Invoke-Step 'guard' { throw 'blocked' }
  $script:nextRan = $true
} catch { if ($_.Exception.Message -ne 'blocked') { throw } }
if ($script:nextRan) { throw 'failure did not stop next step' }
if ($results.Count -ne 1 -or $results[0].Status -ne 'failed') { throw 'failure not recorded' }
`);
});

test('安装前拒绝预存目录与快捷方式，安装失败前不允许清理', () => {
  runFunctions(`
$installDirectory = 'C:\\probe\\owned'
$desktopShortcut = 'C:\\fake-desktop\\DoTodo.lnk'
$startMenuShortcut = 'C:\\fake-menu\\DoTodo.lnk'
$env:LOCALAPPDATA = 'C:\\fake-local'
function Get-DoDoTodoUninstallEntry { @() }
$script:existingPath = $installDirectory
function Test-Path { param($LiteralPath) $LiteralPath -eq $script:existingPath }
function Start-Process { throw 'must not launch' }
function Remove-Item { throw 'must not delete' }
foreach ($p in @($installDirectory, $desktopShortcut, $startMenuShortcut)) {
  $script:existingPath = $p
  $caught = $false
  try { Assert-InstallPreconditions } catch { $caught = $true }
  if (-not $caught) { throw "preexisting path accepted: $p" }
}
$script:existingPath = $installDirectory
$caught = $false
try { Invoke-ProbeInstall } catch { $caught = $true }
if (-not $caught -or $script:installationStarted) { throw 'installation ownership claimed' }
function Invoke-SilentUninstall { throw 'must not uninstall' }
Invoke-ProbeCleanup
`);
});

test('卸载只执行本次目录的命令，不选首项或相邻前缀路径', () => {
  runFunctions(`
$installDirectory = 'C:\\probe\\owned'
$script:installationStarted = $true
$script:launched = @()
$script:pathExists = $true
function Test-Path { $script:pathExists }
function Get-DoDoTodoUninstallEntry {
  [pscustomobject]@{ QuietUninstallString = '"C:\\probe\\owned-other\\Uninstall.exe" /S' }
  [pscustomobject]@{ QuietUninstallString = '"C:\\probe\\owned\\Uninstall.exe" /S' }
}
function Start-Process { param($FilePath, $ArgumentList) $script:launched += $FilePath; $script:pathExists = $false }
function Start-Sleep {}
if (-not (Invoke-SilentUninstall)) { throw 'uninstall failed' }
if ($script:launched.Count -ne 1 -or $script:launched[0] -ne 'C:\\probe\\owned\\Uninstall.exe') { throw 'wrong uninstall launched' }
$script:launched = @(); $script:pathExists = $true
function Get-DoDoTodoUninstallEntry { [pscustomobject]@{ QuietUninstallString = '"C:\\probe\\owned\\..\\other\\Uninstall.exe" /S' } }
function Get-ChildItem { @() }
if (Invoke-SilentUninstall) { throw 'foreign uninstaller accepted' }
if ($script:launched.Count) { throw 'foreign process launched' }
$script:installationStarted = $false
if (Invoke-SilentUninstall) { throw 'unowned install accepted' }
`);
});

test('只有安装进程成功启动后才允许收尾，并遵守保留安装', () => {
  runFunctions(`
$installDirectory = 'C:\\probe\\owned'
$script:installerPath = 'C:\\fake\\setup.exe'
function Assert-InstallPreconditions {}
function Start-Process { throw 'launch failed' }
try { Invoke-ProbeInstall } catch { if ($_.Exception.Message -ne 'launch failed') { throw } }
if ($script:installationStarted) { throw 'failed launch claimed ownership' }
$script:cleanupCount = 0
function Test-Path { $true }
function Invoke-SilentUninstall { $script:cleanupCount++; return $true }
Invoke-ProbeCleanup
if ($script:cleanupCount) { throw 'cleanup without launch' }
function Start-Process { $p = [pscustomobject]@{}; $p | Add-Member ScriptMethod WaitForExit {}; return $p }
Invoke-ProbeInstall
if (-not $script:installationStarted) { throw 'successful launch not recorded' }
Invoke-ProbeCleanup
if ($script:cleanupCount -ne 1) { throw 'owned install not cleaned' }
$KeepInstalled = $true
Invoke-ProbeCleanup
if ($script:cleanupCount -ne 1) { throw 'keep installed ignored' }
`);
});

test('安装目录每次求值产生独立GUID路径且没有删除安装目录的指令', () => {
  runFunctions(`
$assignment = $ast.Find({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$installDirectory'}, $false)
if (-not $assignment) { throw 'missing install directory assignment' }
$expression = [scriptblock]::Create($assignment.Right.Extent.Text)
$first = & $expression; $second = & $expression
if ($first -eq $second -or [IO.Path]::GetFileName($first) -notmatch '^dotodo-install-probe-[0-9a-f]{32}$') { throw 'path is not unique GUID' }
`);
  assert.doesNotMatch(text, /Remove-Item[^\r\n]*\$installDirectory/);
});

test('缺少原始数据显式跳过而不是通过', () => {
  runFunctions(`
$script:stepSkipped = $false
Invoke-Step 'data' { Set-StepSkipped 'no original state' }
if ($results.Count -ne 1 -or $results[0].Status -ne 'skipped') { throw 'missing state falsely passed' }
`);
});

test('用户数据指纹为SHA256，可检测相同长度时间戳的内容变化', () => {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotodo-fingerprint-test-'));
  const fixture = path.join(directory, 'state.json');
  try {
    fs.writeFileSync(fixture, 'one');
    const original = fs.statSync(fixture);
    const first = runFunctions(`$realUserDataDirectory = '${directory.replace(/'/g, "''")}'; Write-Output (Get-UserDataFingerprint)`);
    fs.writeFileSync(fixture, 'two');
    fs.utimesSync(fixture, original.atime, original.mtime);
    const second = runFunctions(`$realUserDataDirectory = '${directory.replace(/'/g, "''")}'; Write-Output (Get-UserDataFingerprint)`);
    assert.notEqual(first, second);
    assert.match(first.trim(), /^[A-F0-9]{64}$/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('verify-installer.ps1 必须保存为带 BOM 的 UTF-8', () => {
  // 和 verify-electron.ps1 同样的原因：文件里全是中文，Windows PowerShell 5.1
  // 没有 BOM 就会按系统 GBK 代码页读，然后满屏语法错误。
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 丢失了。');
});

test('verify-installer.ps1 里没有制表符缩进', () => {
  const offenders = text.split(/\r?\n/).filter((line) => line.includes('\t'));
  assert.deepEqual(offenders, []);
});

test('卸载项按前缀匹配 DisplayName，不能用等号', () => {
  // 真实值是「DoTodo 1.0.0」，带版本号。用 -eq 'DoTodo' 一条都匹配不上 ——
  // 而且这不只是查询失败：「已有安装就不动手」的安全守卫用的是同一个函数，
  // 匹配不上它就会放行，然后覆盖掉用户那套的卸载项。
  const equalityChecks = codeLines().filter(
    (entry) => entry.line.includes('DisplayName') && entry.line.includes('-eq $productName')
  );
  assert.deepEqual(
    equalityChecks.map((entry) => entry.number),
    [],
    'DisplayName 带版本号，必须按前缀匹配。'
  );
  assert.match(text, /DisplayName -match \$pattern/);
});

test('卸载项不要求 InstallLocation 存在', () => {
  // electron-builder 的按用户安装不写这个值。要求它有，就等于要求一个
  // 上游从不提供的字段，这步会永远失败。
  const locationChecks = codeLines().filter(
    (entry) => entry.line.includes('InstallLocation') && entry.line.includes('throw')
  );
  assert.deepEqual(
    locationChecks.map((entry) => entry.number),
    [],
    '不要因为缺少 InstallLocation 就判定失败。'
  );
  // 可执行文件路径的真实行为由上面的隔离卸载测试覆盖。
  assert.match(text, /Get-ProbeQuietUninstallCommand/);
});

test('卸载走注册表里的 QuietUninstallString', () => {
  // 那是 Windows「设置 → 应用」真正会执行的命令，我们要验的就是它管不管用。
  assert.match(text, /QuietUninstallString/);
});

test('检测到已有安装时拒绝动手', () => {
  // 我们静默装到临时目录，但卸载信息是按 appId 写在注册表里的同一个键。
  // 如果用户自己装过 DoTodo，我们再装一次就会覆盖他的卸载入口。
  assert.match(text, /已经装过 DoTodo/);
  runFunctions(`
function Get-DoDoTodoUninstallEntry { [pscustomobject]@{ DisplayName = 'DoTodo 1.0' } }
function Test-Path { throw 'must not reach path checks' }
$caught = $false
try { Assert-InstallPreconditions } catch {
  if ($_.Exception.Message -notlike '*DoTodo*') { throw }
  $caught = $true
}
if (-not $caught) { throw 'existing installation accepted' }
`);
});

test('失败也要把装好的东西收尾卸掉', () => {
  // 中途失败却把应用留在机器上，比失败本身更糟。
  assert.match(text, /finally \{/);
  assert.match(text, /前面有步骤失败，收尾卸载/);
});

test('脚本不会删用户数据目录', () => {
  // 卸载验证跑完，用户的清单必须还在。脚本只允许读这个目录。
  const destructive = codeLines().filter(
    (entry) =>
      entry.line.includes('$realUserDataDirectory') &&
      (entry.line.includes('Remove-Item') || entry.line.includes('New-Item'))
  );
  assert.deepEqual(
    destructive.map((entry) => entry.number),
    [],
    '用户数据目录只能读、不能删也不能建。'
  );
  // 而且要用指纹证明自己没碰过它。
  assert.match(text, /Get-UserDataFingerprint/);
  assert.match(text, /用户数据被改动了/);
});

test('安装相关的断言不依赖退出码', () => {
  // 与 verify-electron.ps1 同样的坑：Start-Process 配合重定向时
  // ExitCode 取不到值，拿它判断会「什么都没查却显示成功」。
  const exitCodeLines = codeLines().filter((entry) => entry.line.includes('.ExitCode'));
  assert.deepEqual(exitCodeLines.map((entry) => entry.number), []);
});

test('package.json 暴露 verify:installer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(manifest.scripts['verify:installer'] || '', /verify-installer\.ps1/);
  // 这个脚本会往机器上装东西，不能混进默认的 verify:win。
  assert.doesNotMatch(manifest.scripts['verify:win'] || '', /verify-installer/);
});
