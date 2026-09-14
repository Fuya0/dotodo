#Requires -Version 5.1
<#
.SYNOPSIS
  DoTodo Windows 安装器验证：安装 → 启动 → 卸载 → 确认收干净。

.DESCRIPTION
  这是发布清单第 5 节里**能自动化**的那一部分。它证明安装包本身的结构是对的：

    - 安装器能静默装到指定目录，程序文件和卸载器都到位
    - 桌面和开始菜单的快捷方式建出来了
    - 卸载信息写进了注册表，指向正确的目录
    - **装好的那份副本真的能启动**（跑它的 --smoke-test，要求壳层和托盘起来）
    - 卸载之后程序文件、快捷方式、注册表项都被清掉
    - 用户数据目录**没有被删**（重装后清单还得在）

  它**不能**替代干净机器验证。干净机器才能发现「开发机上残留的注册表和缓存
  把问题盖住了」这一类，还有杀毒软件误报、UAC 行为、覆盖升级路径。
  这几条仍然要人工做，见 docs/release/windows-release-checklist.md 第 5 节。

  副作用都在临时目录里，卸载时清掉。会短暂出现一个桌面「DoTodo」图标
  （卸载会删掉它）。为了不破坏你自己的安装，检测到已有 DoTodo 安装时会直接
  拒绝运行，而不是覆盖它的注册表项。

.EXAMPLE
  npm run verify:installer
  powershell -File tools/verify-installer.ps1 -KeepInstalled
#>
[CmdletBinding()]
param(
  # 装完不卸载（排查问题时用；正常跑完会自动卸载）。
  [switch]$KeepInstalled,
  # 指定安装器路径。默认取 release\DoTodo-Setup-*.exe。
  [string]$Installer
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$productName = 'DoTodo'
$installDirectory = Join-Path $env:TEMP 'dotodo-install-probe'
$smokeDataDirectory = Join-Path $env:TEMP ("dotodo-install-smoke-" + [guid]::NewGuid().ToString('N'))
$smokeStdout = Join-Path $env:TEMP ("dotodo-install-smoke-" + [guid]::NewGuid().ToString('N') + '.out')
$smokeStderr = "$smokeStdout.err"
$realUserDataDirectory = Join-Path $env:APPDATA 'dotodo'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"
$startMenuShortcut = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') "$productName.lnk"

$results = New-Object System.Collections.Generic.List[object]
$script:failures = @()
$script:uninstallAttempted = $false

function Write-Section([string]$Title) {
  Write-Host ''
  $bar = '─' * [Math]::Max(4, 64 - $Title.Length)
  Write-Host "── $Title $bar" -ForegroundColor Cyan
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

function Get-DoDoTodoUninstallEntry {
  # 注册表项的属性集不固定，直接点属性在 Set-StrictMode 下会抛异常，
  # 所以先确认属性存在。
  #
  # DisplayName 实际是「DoTodo 1.0.0」，带版本号。早先这里写的是 -eq 'DoTodo'，
  # 一条都匹配不上。那不只是查询失败：下面「已有安装就不动手」的安全守卫用的是
  # 同一个函数，匹配不上它就会放行，然后覆盖掉用户自己那套的卸载项。
  $pattern = "^$([regex]::Escape($productName))(\s|$)"
  $entries = @()
  foreach ($path in @(
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )) {
    $entries += Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match $pattern }
  }
  return $entries
}

function Get-RegistryValue($Entry, [string]$Name) {
  # 注册表项缺哪个值是不确定的，缺了就返回空，别让 StrictMode 抛。
  if ($Entry -and $Entry.PSObject.Properties[$Name]) { return $Entry.$Name }
  return $null
}

function Get-UserDataFingerprint {
  # 记录真实数据目录的指纹，用来证明这个脚本没碰过它。
  # 目录可能不存在（全新机器），那就返回空。
  $statePath = Join-Path $realUserDataDirectory 'state.json'
  if (-not (Test-Path $statePath)) { return $null }
  $item = Get-Item $statePath
  return "$($item.Length):$($item.LastWriteTimeUtc.Ticks)"
}

function Invoke-SilentUninstall {
  if (-not (Test-Path $installDirectory)) { return $true }

  # 优先用注册表里的 QuietUninstallString：那正是 Windows「设置 → 应用」
  # 会执行的命令，我们要验的就是它管不管用。
  $entry = @(Get-DoDoTodoUninstallEntry) | Select-Object -First 1
  $quiet = Get-RegistryValue $entry 'QuietUninstallString'
  $started = $false
  if ($quiet) {
    $parsed = [regex]::Match($quiet.Trim(), '^"([^"]+)"\s*(.*)$')
    if ($parsed.Success) {
      Start-Process -FilePath $parsed.Groups[1].Value -ArgumentList $parsed.Groups[2].Value.Trim() `
        -ErrorAction SilentlyContinue | Out-Null
      $started = $true
    }
  }
  if (-not $started) {
    $uninstaller = Get-ChildItem -Path $installDirectory -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $uninstaller) { return $false }
    Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -ErrorAction SilentlyContinue | Out-Null
  }

  # NSIS 的卸载器会把自己复制到临时目录再重新启动，所以第一次返回不代表卸完了。
  # 只能等安装目录真的消失。
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path $installDirectory)) { return $true }
  }
  return $false
}

Write-Host "$productName Windows 安装器验证" -ForegroundColor White
Write-Host "仓库：$repoRoot"
Write-Host "安装目录：$installDirectory"

$dataFingerprintBefore = Get-UserDataFingerprint

try {
  Invoke-Step '安装器就位' {
    $resolved = if ($Installer) {
      if ([System.IO.Path]::IsPathRooted($Installer)) { $Installer } else { Join-Path $repoRoot $Installer }
    } else {
      $candidate = Get-ChildItem -Path (Join-Path $repoRoot 'release') -Filter 'DoTodo-Setup-*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($candidate) { $candidate.FullName } else { $null }
    }
    if (-not $resolved -or -not (Test-Path $resolved)) {
      throw '找不到安装器。先执行 npm run dist:win。'
    }
    # 后面几步都要用这个路径，而每个步骤跑在自己的作用域里，所以存到脚本作用域。
    $script:installerPath = $resolved
    $item = Get-Item $resolved
    Write-Host ("  {0}（{1:N1} MB，构建于 {2}）" -f $item.Name, ($item.Length / 1MB), $item.LastWriteTime)
    # 注意上面必须写成括号包起来的表达式。直接跟 -f 的话 PowerShell 会把 -f 当成
    # -ForegroundColor 的缩写，然后试图把 106.25 这个数字转成 ConsoleColor 而报错。

    # 安装器只重建在 dist:win 里，源码改了它不会自动跟着变。
    # 报一个过期的体积数字会误导人，所以这里直接说清楚。
    $newestSource = @(
      Get-ChildItem -File -Recurse (Join-Path $repoRoot 'src') -ErrorAction SilentlyContinue
      Get-ChildItem -File -Recurse (Join-Path $repoRoot 'assets') -ErrorAction SilentlyContinue
      Get-Item (Join-Path $repoRoot 'package.json')
    ) | Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1
    if ($newestSource -and $item.LastWriteTime -lt $newestSource.LastWriteTime) {
      throw "安装器比源码旧（较新的源码：$($newestSource.Name)）。先重新执行 npm run dist:win。"
    }
  }

  Invoke-Step '没有已存在的安装会被破坏' {
    # 卸载信息是按 appId/productName 写在注册表里的。如果用户已经装了 DoTodo，
    # 我们再静默装一次会覆盖同一个键，卸载时就会把用户那套的卸载入口删掉。
    # 这种事不能默默做，直接拒绝。
    $existing = @(Get-DoDoTodoUninstallEntry)
    if ($existing.Count -gt 0) {
      # electron-builder 不写 InstallLocation，所以位置从卸载命令里取。
      $locations = ($existing | ForEach-Object {
          $line = Get-RegistryValue $_ 'UninstallString'
          if ($line) { $line } else { Get-RegistryValue $_ 'DisplayName' }
        }) -join '；'
      throw "已经装过 DoTodo（$locations）。请先卸载，或在干净机器上跑这个脚本。"
    }
    $programFilesCopy = Join-Path $env:LOCALAPPDATA "Programs\$productName"
    if (Test-Path $programFilesCopy) {
      throw "默认安装位置已有内容：$programFilesCopy。请先清理。"
    }
    Write-Host '  没有检测到已存在的安装，可以安全地装到临时目录。'
  }

  Invoke-Step '静默安装到临时目录' {
    Remove-Item $installDirectory -Recurse -Force -ErrorAction SilentlyContinue
    $arguments = "/S /D=$installDirectory"
    # /D= 必须是最后一个参数，而且不能加引号：NSIS 把 /D= 之后整行都当成路径。
    # Start-Process 传单个字符串时是原样交给 CreateProcess 的，正合要求。
    Start-Process -FilePath $script:installerPath -ArgumentList $arguments -Wait -ErrorAction SilentlyContinue | Out-Null

    if (-not (Test-Path $installDirectory)) {
      throw "安装后目录不存在：$installDirectory"
    }
  }

  Invoke-Step '程序文件与卸载器到位' {
    $executable = Join-Path $installDirectory "$productName.exe"
    if (-not (Test-Path $executable)) {
      throw "缺少主程序：$executable"
    }
    $uninstaller = Get-ChildItem -Path $installDirectory -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $uninstaller) {
      throw "缺少卸载器（Uninstall*.exe）于 $installDirectory"
    }
    Write-Host "  主程序：$executable"
    Write-Host "  卸载器：$($uninstaller.Name)"
  }

  Invoke-Step '快捷方式已创建' {
    if (-not (Test-Path $desktopShortcut)) {
      throw "桌面快捷方式没建出来：$desktopShortcut"
    }
    if (-not (Test-Path $startMenuShortcut)) {
      throw "开始菜单快捷方式没建出来：$startMenuShortcut"
    }
    Write-Host '  桌面与开始菜单快捷方式都在。'
  }

  Invoke-Step '注册表写入卸载信息' {
    $entries = @(Get-DoDoTodoUninstallEntry)
    if ($entries.Count -eq 0) {
      throw "$productName 没有出现在注册表的卸载项里。"
    }
    $entry = $entries[0]
    Write-Host ("  DisplayName : {0}" -f (Get-RegistryValue $entry 'DisplayName'))
    $version = Get-RegistryValue $entry 'DisplayVersion'
    if ($version) { Write-Host "  DisplayVersion: $version" }
    $installLocation = Get-RegistryValue $entry 'InstallLocation'
    if ($installLocation) { Write-Host "  InstallLocation: $installLocation" }

    # electron-builder 的按用户安装**不写** InstallLocation，所以不能要求它有。
    # 真正该验的是「这个卸载项指向我们刚装的那个目录」——否则点卸载会去删别处。
    # 卸载命令和图标路径都带着绝对路径，用它们判断。
    $evidence = @(
      (Get-RegistryValue $entry 'UninstallString')
      (Get-RegistryValue $entry 'QuietUninstallString')
      (Get-RegistryValue $entry 'DisplayIcon')
    ) | Where-Object { $_ }
    if ($evidence.Count -eq 0) {
      throw '卸载项里既没有卸载命令也没有图标路径，无法确认它指向哪里。'
    }
    $pointsAtUs = $false
    foreach ($line in $evidence) {
      if ($line -like "*$installDirectory*") { $pointsAtUs = $true }
      Write-Host "  $line"
    }
    if (-not $pointsAtUs) {
      throw "卸载项没有指向这次安装的目录（$installDirectory）。"
    }
  }

  Invoke-Step '装好的副本能启动' {
    # 冒烟模式要求这个变量，缺了会拒绝启动；这也保证它不会碰真实用户数据。
    $previousData = $env:DOTODO_SMOKE_USER_DATA
    $env:DOTODO_SMOKE_USER_DATA = $smokeDataDirectory
    $app = $null
    try {
      $app = Start-Process -FilePath (Join-Path $installDirectory "$productName.exe") `
        -ArgumentList '--smoke-test' -PassThru `
        -RedirectStandardOutput $smokeStdout -RedirectStandardError $smokeStderr
      if (-not $app.WaitForExit(30000)) {
        throw '装好的副本 30 秒内没有自己退出，壳层可能卡住了。'
      }
      $text = if (Test-Path $smokeStdout) { Get-Content $smokeStdout -Raw -Encoding UTF8 } else { '' }
      if ($text -notmatch 'DOTODO_SMOKE_READY') {
        throw "装好的副本没有报告 DOTODO_SMOKE_READY。标准输出：`n$text"
      }
      $boot = [regex]::Match($text, 'DOTODO_SHELL_BOOT (\{.*\})')
      if (-not $boot.Success) {
        throw "装好的副本没有报告壳层启动结果。标准输出：`n$text"
      }
      $shell = $boot.Groups[1].Value | ConvertFrom-Json
      if (-not $shell.trayCreated) {
        throw '装好的副本没有创建托盘图标。'
      }
      Write-Host '  ✓ 装好的副本启动成功，托盘图标已创建。'
    } finally {
      if ($app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      }
      if ($null -eq $previousData) { Remove-Item Env:\DOTODO_SMOKE_USER_DATA -ErrorAction SilentlyContinue }
      else { $env:DOTODO_SMOKE_USER_DATA = $previousData }
      Remove-Item $smokeDataDirectory -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item $smokeStdout -Force -ErrorAction SilentlyContinue
      Remove-Item $smokeStderr -Force -ErrorAction SilentlyContinue
    }
  }

  if (-not $KeepInstalled) {
    Invoke-Step '静默卸载并确认收干净' {
      $script:uninstallAttempted = $true
      if (-not (Invoke-SilentUninstall)) {
        throw "卸载后目录仍然存在：$installDirectory"
      }
      if (Test-Path $desktopShortcut) {
        throw "桌面快捷方式没有被删掉：$desktopShortcut"
      }
      if (Test-Path $startMenuShortcut) {
        throw "开始菜单快捷方式没有被删掉：$startMenuShortcut"
      }
      $entries = @(Get-DoDoTodoUninstallEntry)
      if ($entries.Count -gt 0) {
        throw '注册表里的卸载项没有被删掉。'
      }
      Write-Host '  程序文件、快捷方式、注册表项都已清理。'
    }

    Invoke-Step '用户数据被保留' {
      # 卸载**不能**删用户数据：重装之后清单还得在。
      # 这里同时证明脚本自己也没碰过它 —— 指纹是脚本开始前记的。
      if ($null -eq $dataFingerprintBefore) {
        Write-Host '  真实数据目录本来就不存在，这一条无从判断（不代表通过）。' -ForegroundColor Yellow
        return
      }
      if (-not (Test-Path $realUserDataDirectory)) {
        throw "用户数据目录被删掉了：$realUserDataDirectory"
      }
      $after = Get-UserDataFingerprint
      if ($after -ne $dataFingerprintBefore) {
        throw "用户数据被改动了（$dataFingerprintBefore → $after）。这个脚本不该碰它。"
      }
      Write-Host '  用户数据目录还在，且内容和时间戳都没变。'
    }
  } else {
    Write-Host ''
    Write-Host '按 -KeepInstalled 保留安装，跳过卸载步骤。' -ForegroundColor Yellow
    Write-Host "  手工卸载：$installDirectory"
  }
} finally {
  # 不管前面哪一步失败，都不要把装好的东西留在机器上。
  if (-not $KeepInstalled -and -not $script:uninstallAttempted -and (Test-Path $installDirectory)) {
    Write-Host ''
    Write-Host '前面有步骤失败，收尾卸载……' -ForegroundColor Yellow
    if (Invoke-SilentUninstall) {
      Write-Host '  已卸载。' -ForegroundColor Yellow
    } else {
      Write-Host "  ✗ 自动卸载没成功，请手动运行：$installDirectory\Uninstall $productName.exe" -ForegroundColor Red
    }
  }
}

Write-Section '验证汇总'
$results | Format-Table -Property Step, Status, Seconds -AutoSize | Out-String | Write-Host

if ($script:failures.Count -gt 0) {
  Write-Host "✗ $($script:failures.Count) 个步骤失败：$($script:failures -join '、')" -ForegroundColor Red
  exit 1
}

Write-Host '✓ 安装器自动验证步骤通过。' -ForegroundColor Green
Write-Host ''
Write-Host '这**不能**替代干净机器验证。仍然只能人工的部分：' -ForegroundColor Yellow
Write-Host '  docs/release/windows-release-checklist.md 第 5 节'
Write-Host '  （覆盖升级、杀毒误报、UAC 行为、以及残留缓存掩盖的问题）'
exit 0
