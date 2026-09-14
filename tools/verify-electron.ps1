#Requires -Version 5.1
<#
.SYNOPSIS
  DoTodo Windows 自动验证脚本。

.DESCRIPTION
  按顺序执行：环境信息 → 单元测试 → 冒烟测试 → 交互场景 → 打包到目录 →
  体积分类 → 打包版壳层启动 → 空闲内存。
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
  # 跳过启动打包后的应用的两步：打包版壳层启动、空闲内存测量。
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

function Get-ProcessTreeId([int]$RootId) {
  # Electron 是「主进程 + 若干子进程」（GPU、渲染、工具进程）。要量这个应用的
  # 内存就得把整棵树加起来，而按进程名抓会把机器上别的实例也一起算进去。
  $all = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Select-Object ProcessId, ParentProcessId
  )
  $ids = @($RootId)
  do {
    $added = $false
    foreach ($entry in $all) {
      if ($ids -contains $entry.ParentProcessId -and $ids -notcontains $entry.ProcessId) {
        $ids += [int]$entry.ProcessId
        $added = $true
      }
    }
  } while ($added)
  return $ids
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

Invoke-Step '交互场景 (npm run ui-check)' {
  Write-Host '在真实渲染进程里点按钮、按键，并断言 DOM。'
  Write-Host '每个场景跑完会留一张截图在 shots\ui\，可以直接看一眼界面。'
  npm run ui-check
  Assert-NativeSuccess 'npm run ui-check' $LASTEXITCODE
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
    # 这个脚本只跑 pack（重建 win-unpacked），不重建安装器。
    # 所以磁盘上的安装器可能来自更早的源码 —— 直接报它的体积会误导人。
    # 比较基准必须是**源码**，不能是 win-unpacked：本脚本刚刚重建过它，
    # 拿它当基准的话安装器永远显示为"陈旧"。
    $sourceFiles = @(
      Get-ChildItem -File -Recurse (Join-Path $repoRoot 'src') -ErrorAction SilentlyContinue
      Get-ChildItem -File -Recurse (Join-Path $repoRoot 'assets') -ErrorAction SilentlyContinue
      Get-Item (Join-Path $repoRoot 'package.json')
    )
    $newestSource = $sourceFiles |
      Sort-Object -Property LastWriteTime -Descending |
      Select-Object -First 1
    if ($newestSource -and ($installer.LastWriteTime -lt $newestSource.LastWriteTime)) {
      Write-Host '⚠ 安装器比源码旧：它对应的不是当前代码。' -ForegroundColor Yellow
      Write-Host "  安装器 $($installer.LastWriteTime)；较新的源码 $($newestSource.LastWriteTime)（$($newestSource.Name)）。" -ForegroundColor Yellow
      Write-Host '  重新执行 npm run dist:win 再记录体积。' -ForegroundColor Yellow
    }
    Write-Host '注意：安装后体积、打包目录体积和下载体积是三个不同的数字，不要混为一个。'
  } else {
    Write-Host ''
    Write-Host '安装器：尚未构建（需要时执行 npm run dist:win）。'
  }
}

if (-not $SkipMemory) {
  Invoke-Step '打包版壳层启动' {
    # npm run smoke 跑的是开发版（electron .）。打包进 app.asar 之后代码还认不认
    # 得路径、托盘还建不建得起来，是另一回事，之前没有任何一步验证过。
    # 这一步跑打包版自己的 --smoke-test，确认壳层真的起来了。
    #
    # 断言只落在 stdout 的标记上：Start-Process 配合输出重定向时，
    # $process.ExitCode 取不到值（HasExited 为真但 ExitCode 为空），
    # 拿退出码判断会得到「什么都没发生」的假象。
    $executable = Join-Path $resolvedPackagedDirectory 'DoTodo.exe'
    if (-not (Test-Path $executable)) {
      throw "找不到 $executable（去掉 -SkipMemory，或先完成打包）"
    }

    $probeData = Join-Path $env:TEMP ("dotodo-boot-" + [guid]::NewGuid().ToString('N'))
    $stdout = "$probeData.out"
    $stderr = "$probeData.err"
    $previousData = $env:DOTODO_SMOKE_USER_DATA
    # 打包版的 smoke 模式要求这个变量，缺了会直接拒绝启动 —— 这是好事：
    # 它保证冒烟永远不可能碰到真实数据。
    $env:DOTODO_SMOKE_USER_DATA = $probeData
    $app = $null
    try {
      Write-Host '用 --smoke-test 启动打包版（一次性数据目录）……'
      $app = Start-Process -FilePath $executable -ArgumentList '--smoke-test' -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
      if (-not $app.WaitForExit(30000)) {
        throw '打包版 30 秒内没有自己退出，壳层可能卡住了。'
      }
      $text = if (Test-Path $stdout) { Get-Content $stdout -Raw -Encoding UTF8 } else { '' }
      if ($text -notmatch 'DOTODO_SMOKE_READY') {
        throw "打包版没有报告 DOTODO_SMOKE_READY。标准输出：`n$text"
      }
      $boot = [regex]::Match($text, 'DOTODO_SHELL_BOOT (\{.*\})')
      if (-not $boot.Success) {
        throw "打包版没有报告壳层启动结果。标准输出：`n$text"
      }
      $shell = $boot.Groups[1].Value | ConvertFrom-Json
      if (-not $shell.trayCreated) {
        throw '打包版的托盘图标没有创建成功。'
      }
      Write-Host '✓ 打包版的壳层启动成功，托盘图标已创建。'
      if ($shell.shortcut -and $shell.shortcut.warning) {
        # 别的实例占着全局快捷键时属于正常降级，不是失败。
        Write-Host "  快捷键降级（正常）：$($shell.shortcut.warning)"
      }
      if ($shell.warnings.Count -gt 0) {
        Write-Host "  壳层警告：$($shell.warnings -join '；')" -ForegroundColor Yellow
      }
    } finally {
      if ($app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      }
      if ($null -eq $previousData) { Remove-Item Env:\DOTODO_SMOKE_USER_DATA -ErrorAction SilentlyContinue }
      else { $env:DOTODO_SMOKE_USER_DATA = $previousData }
      for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Start-Sleep -Milliseconds 400
        Remove-Item $probeData -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $stdout -Force -ErrorAction SilentlyContinue
        Remove-Item $stderr -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $probeData)) { break }
      }
    }
  }
}

if (-not $SkipMemory) {
  Invoke-Step '打包应用空闲内存' {
    $executable = Join-Path $resolvedPackagedDirectory 'DoTodo.exe'
    if (-not (Test-Path $executable)) {
      throw "找不到 $executable（去掉 -SkipMemory，或先完成打包）"
    }

    # 用一次性数据目录启动这个打包版，图三件事：
    #   1. 不撞单实例锁。锁是按数据目录（%APPDATA%\dotodo）算的，开发版
    #      （npm start）和安装版共用它。用真实目录启动的话，只要桌面上开着
    #      这个应用，这一步就永远只能「跳过」——而一个永远跳过的步骤等于
    #      没有验证，它坏掉了也没人知道。
    #   2. 不碰你真实的数据。打包版启动时会做一次日切准备，可能写归档。
    #   3. 不必去猜哪些进程是别人的，也就不必关掉你正开着的窗口。
    # 空清单对「空闲内存」这个数字没有影响。
    $probeData = Join-Path $env:TEMP ("dotodo-mem-" + [guid]::NewGuid().ToString('N'))
    Write-Host '启动打包后的应用（一次性数据目录，测完删掉）……'
    # 先置空：Set-StrictMode 下引用没赋过值的变量会抛异常，
    # 万一 Start-Process 自己就失败了，finally 里不能崩第二次。
    $app = $null
    $app = Start-Process -FilePath $executable -ArgumentList "--user-data-dir=$probeData" -PassThru
    try {
      Start-Sleep -Seconds 8
      $tree = @(Get-Process -Id (Get-ProcessTreeId -RootId $app.Id) -ErrorAction SilentlyContinue)
      if ($tree.Count -eq 0) {
        # 不报 ExitCode：Start-Process 拿不到它（见上一步的说明）。
        throw '打包后的应用没有起来（进程树是空的）。'
      }
      $workingSet = ($tree | Measure-Object -Property WorkingSet64 -Sum).Sum
      $privateBytes = ($tree | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
      Write-Host ("进程数        : {0}" -f $tree.Count)
      Write-Host ("工作集合计    : {0}" -f (Format-Bytes $workingSet))
      Write-Host ("私有内存合计  : {0}" -f (Format-Bytes $privateBytes))
      Write-Host '参考：Chromium 多进程模型下，一个进程 60–120 MB 属于正常范围。'
    } finally {
      # 只收自己拉起来的那一个。曾经这里是「把所有 DoTodo 进程都杀掉」，
      # 那等于替用户关掉他正开着的应用——脚本没这个权力。
      if ($app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      }
      for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (-not (Test-Path $probeData)) { break }
        Remove-Item $probeData -Recurse -Force -ErrorAction SilentlyContinue
      }
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
