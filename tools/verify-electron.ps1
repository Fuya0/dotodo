#Requires -Version 5.1
<#
.SYNOPSIS
  DoTodo Windows 自动验证脚本。

.DESCRIPTION
  按顺序执行：环境信息 → 单元测试 → 冒烟测试 → 打包到目录 → 体积分类 → 空闲内存。
  退出码 0 表示全部通过；任何一步失败都会以非 0 退出，并打印失败步骤名。

  这个脚本只覆盖「能自动化」的部分。透明窗口、托盘、多显示器、DPI、开机启动和
  数据恢复必须人工过一遍：docs/testing/electron-windows-manual-checklist.md

.EXAMPLE
  npm run verify:win
  powershell -File tools/verify-electron.ps1 -SkipPack
  powershell -File tools/verify-electron.ps1 -SkipMemory
#>
[CmdletBinding()]
param(
  # 跳过 electron-builder 打包（只想快速跑测试时用）。
  [switch]$SkipPack,
  # 跳过空闲内存测量（不想启动打包后的应用时用）。
  [switch]$SkipMemory,
  # 指定已存在的打包目录，配合 -SkipPack 使用。
  [string]$PackagedDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$results = New-Object System.Collections.Generic.List[object]
$script:failures = @()

function Write-Section([string]$Title) {
  Write-Host ''
  $bar = '─' * [Math]::Max(4, 64 - $Title.Length)
  Write-Host "── $Title $bar" -ForegroundColor Cyan
}

function Format-Bytes([double]$Bytes) {
  if ($Bytes -lt 1024) { return "$([Math]::Round($Bytes)) B" }
  $value = $Bytes
  $unit = 'B'
  foreach ($candidate in @('KB', 'MB', 'GB', 'TB')) {
    $value = $value / 1024
    $unit = $candidate
    if ($value -lt 1024) { break }
  }
  return ('{0:N1} {1}' -f $value, $unit)
}

function Invoke-Step {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Body
  )
  Write-Section $Name
  $started = Get-Date
  try {
    & $Body
    $elapsed = (Get-Date) - $started
    $results.Add([pscustomobject]@{
      Step    = $Name
      Status  = 'passed'
      Seconds = [Math]::Round($elapsed.TotalSeconds, 1)
    })
  } catch {
    $elapsed = (Get-Date) - $started
    $results.Add([pscustomobject]@{
      Step    = $Name
      Status  = 'failed'
      Seconds = [Math]::Round($elapsed.TotalSeconds, 1)
    })
    Write-Host "✗ $Name" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    $script:failures += $Name
  }
}

function Assert-NativeSuccess([string]$What, [int]$Code) {
  if ($Code -ne 0) { throw "$What 退出码为 $Code" }
}

Set-Location $repoRoot

Write-Host 'DoTodo Windows 自动验证' -ForegroundColor White
Write-Host "仓库：$repoRoot"

Invoke-Step '环境信息' {
  $manifest = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
  Write-Host "Node.js           : $(node --version)"
  Write-Host "npm               : $(npm --version)"
  Write-Host "Electron (锁定)   : $($manifest.devDependencies.electron)"
  Write-Host "PowerShell        : $($PSVersionTable.PSVersion)"
  Write-Host "操作系统          : $([System.Environment]::OSVersion.VersionString)"

  $electronBinary = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electronBinary)) {
    throw ' 找不到 node_modules\electron\dist\electron.exe，请先执行 npm install。'
  }
}

Invoke-Step '单元与集成测试 (npm test)' {
  npm test
  Assert-NativeSuccess 'npm test' $LASTEXITCODE
}

Invoke-Step '冒烟测试 (npm run smoke)' {
  Write-Host '启动真实 Electron，使用隔离的临时用户数据目录。'
  npm run smoke
  Assert-NativeSuccess 'npm run smoke' $LASTEXITCODE
}

if (-not $SkipPack) {
  Invoke-Step '打包到目录 (npm run pack)' {
    npm run pack
    Assert-NativeSuccess 'npm run pack' $LASTEXITCODE
  }
}

$resolvedPackagedDirectory = if ($PackagedDirectory) {
  if ([System.IO.Path]::IsPathRooted($PackagedDirectory)) { $PackagedDirectory }
  else { Join-Path $repoRoot $PackagedDirectory }
} else {
  Join-Path $repoRoot 'release\win-unpacked'
}

Invoke-Step '打包产物体积分类' {
  if (-not (Test-Path $resolvedPackagedDirectory)) {
    throw "找不到打包目录：$resolvedPackagedDirectory（去掉 -SkipPack，或用 -PackagedDirectory 指定）"
  }

  $files = @(Get-ChildItem -File -Recurse $resolvedPackagedDirectory)
  if ($files.Count -eq 0) { throw "打包目录是空的：$resolvedPackagedDirectory" }
  $totalBytes = ($files | Measure-Object -Property Length -Sum).Sum

  $tagged = foreach ($file in $files) {
    $relative = $file.FullName.Substring($resolvedPackagedDirectory.Length).TrimStart('\', '/')
    $category = if ($relative -like 'locales\*') { '语言包 locales' }
    elseif ($relative -like 'resources\*') { '应用代码 resources' }
    elseif ($relative -like '*.dll') { '动态库 dll' }
    elseif ($relative -like '*.pak') { 'Chromium 资源 pak' }
    elseif ($relative -like '*.exe') { '可执行文件 exe' }
    elseif ($relative -like '*.bin' -or $relative -like '*.dat') { 'V8 / ICU 数据' }
    elseif ($relative -like '*.json') { '配置 json' }
    else { '其他' }
    [pscustomobject]@{ Category = $category; Length = $file.Length; Relative = $relative }
  }

  Write-Host ''
  Write-Host ("{0,-20} {1,12}  {2}" -f '分类', '大小', '占比 / 文件数')
  Write-Host ('-' * 62)
  $tagged |
    Group-Object Category |
    Sort-Object -Property { ($_.Group | Measure-Object -Property Length -Sum).Sum } -Descending |
    ForEach-Object {
      $sum = ($_.Group | Measure-Object -Property Length -Sum).Sum
      $share = if ($totalBytes -gt 0) { $sum / $totalBytes } else { 0 }
      Write-Host ("{0,-20} {1,12}  {2,6:P1}  ({3} 个)" -f $_.Name, (Format-Bytes $sum), $share, $_.Count)
    }
  Write-Host ('-' * 62)
  Write-Host ("{0,-20} {1,12}  ({2} 个文件)" -f '打包目录合计', (Format-Bytes $totalBytes), $files.Count)

  $asar = Join-Path $resolvedPackagedDirectory 'resources\app.asar'
  if (Test-Path $asar) {
    $asarSize = (Get-Item $asar).Length
    $enterpriseShare = if ($totalBytes -gt 0) { $asarSize / $totalBytes } else { 0 }
    Write-Host ("{0,-20} {1,12}  {2,6:P1}  ← 应用自身代码" -f 'app.asar', (Format-Bytes $asarSize), $enterpriseShare)
  }

  $installer = Get-ChildItem -Path (Join-Path $repoRoot 'release') -Filter 'DoTodo-Setup-*.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($installer) {
    Write-Host ''
    Write-Host ("安装器下载体积：{0}（{1}）" -f (Format-Bytes $installer.Length), $installer.Name)
    Write-Host '注意：安装后体积、打包目录体积和下载体积是三个不同的数字，不要混为一个。'
  } else {
    Write-Host ''
    Write-Host '安装器：尚未构建（需要时执行 npm run dist:win）。'
  }
}

if (-not $SkipMemory) {
  Invoke-Step '打包应用空闲内存' {
    $executable = Join-Path $resolvedPackagedDirectory 'DoTodo.exe'
    if (-not (Test-Path $executable)) {
      throw "找不到 $executable（去掉 -SkipMemory，或先完成打包）"
    }

    $running = @(Get-Process -Name 'DoTodo' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
      Write-Host '检测到 DoTodo 已在运行，跳过内存测量：' -ForegroundColor Yellow
      Write-Host '  一是单实例锁会让新进程立刻退出，二是收尾时不该动你正在用的窗口。'
      return
    }

    Write-Host '启动打包后的应用（会使用真实用户数据目录）……'
    Start-Process -FilePath $executable | Out-Null
    try {
      Start-Sleep -Seconds 8
      $tree = @(Get-Process -Name 'DoTodo' -ErrorAction SilentlyContinue)
      if ($tree.Count -eq 0) { throw 'DoTodo 进程没有起来。' }
      $workingSet = ($tree | Measure-Object -Property WorkingSet64 -Sum).Sum
      $privateBytes = ($tree | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
      Write-Host ("进程数        : {0}" -f $tree.Count)
      Write-Host ("工作集合计    : {0}" -f (Format-Bytes $workingSet))
      Write-Host ("私有内存合计  : {0}" -f (Format-Bytes $privateBytes))
      Write-Host '参考：Chromium 多进程模型下，一个进程 60–120 MB 属于正常范围。'
    } finally {
      Get-Process -Name 'DoTodo' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Section '验证汇总'
$results | Format-Table -Property Step, Status, Seconds -AutoSize | Out-String | Write-Host

if ($script:failures.Count -gt 0) {
  Write-Host "✗ $($script:failures.Count) 个步骤失败：$($script:failures -join '、')" -ForegroundColor Red
  exit 1
}

Write-Host '✓ 所有自动验证步骤通过。' -ForegroundColor Green
Write-Host ''
Write-Host '自动化通过 ≠ 界面验收通过。请继续执行：' -ForegroundColor Yellow
Write-Host '  docs/testing/electron-windows-manual-checklist.md'
exit 0
