# DoTodo Windows Stack Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build equivalent disposable WPF and Tauri windows, measure their Windows distribution cost, and select the production stack with recorded evidence.

**Architecture:** Each spike is an isolated application under `spikes/` and shares no production code. A PowerShell measurement script produces a Markdown-compatible result table from release artifacts and live processes.

**Tech Stack:** WPF on .NET Framework 4.8; Tauri 2 with vanilla HTML/CSS/JavaScript and Rust; PowerShell measurement tooling.

**Spec:** `docs/superpowers/specs/2026-09-11-dotodo-stack-spike-design.md`

## Global Constraints

- Target Windows 10 22H2 and Windows 11 on x64.
- Spike code is disposable and must not be imported by the production application.
- Both windows render the same static content and expose normal/topmost mode plus opacity.
- Record external runtime dependencies beside every size number.
- Do not create a production installer or upload anything to GitHub.

---

### Task 1: WPF measurement application

**Files:**
- Create: `spikes/wpf/DoTodo.WpfSpike.csproj`
- Create: `spikes/wpf/App.xaml`
- Create: `spikes/wpf/App.xaml.cs`
- Create: `spikes/wpf/MainWindow.xaml`
- Create: `spikes/wpf/MainWindow.xaml.cs`

**Interfaces:**
- Consumes: Windows .NET Framework 4.8 runtime and WPF windowing.
- Produces: `spikes/wpf/bin/Release/net48/DoTodo.WpfSpike.exe` and a window titled `DoTodo WPF Spike`.

- [ ] **Step 1: Create the SDK-style WPF project**

```xml
<Project Sdk="Microsoft.NET.Sdk.WindowsDesktop">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net48</TargetFramework>
    <UseWPF>true</UseWPF>
    <UseWindowsForms>true</UseWindowsForms>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
</Project>
```

- [ ] **Step 2: Add a 390×610 transparent window with fixed sample tasks**

The root window must use `WindowStyle="None"`, `AllowsTransparency="True"`, `Opacity="0.94"`, `Background="Transparent"`, and `Title="DoTodo WPF Spike"`. Add three sample rows matching the visual companion.

- [ ] **Step 3: Add tray and mode controls**

Create a `NotifyIcon`; implement buttons that set `Topmost` and `Opacity`. Closing hides the window, and the tray menu provides Show and Exit.

- [ ] **Step 4: Build Release and record output**

Run: `dotnet build spikes/wpf/DoTodo.WpfSpike.csproj -c Release`

Expected: exit code 0 and `DoTodo.WpfSpike.exe` under `bin/Release/net48/`.

- [ ] **Step 5: Smoke-test the process**

Start the executable, confirm a visible process and window title, capture working set after 10 seconds, then exit through an explicit `--smoke-test` timer.

### Task 2: Tauri measurement application

**Files:**
- Create: `spikes/tauri/package.json`
- Create: `spikes/tauri/index.html`
- Create: `spikes/tauri/styles.css`
- Create: `spikes/tauri/src-tauri/Cargo.toml`
- Create: `spikes/tauri/src-tauri/build.rs`
- Create: `spikes/tauri/src-tauri/tauri.conf.json`
- Create: `spikes/tauri/src-tauri/capabilities/default.json`
- Create: `spikes/tauri/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: Windows WebView2 runtime, Tauri 2 window and tray modules.
- Produces: `spikes/tauri/src-tauri/target/release/dotodo-tauri-spike.exe` and a window titled `DoTodo Tauri Spike`.

- [ ] **Step 1: Create the minimal Tauri project files**

Use `tauri = { version = "2", features = ["tray-icon"] }`, `tauri-build = "2"`, and no JavaScript framework or npm runtime dependency.

- [ ] **Step 2: Create the equivalent static window**

Set the window to 390×610, transparent, decorated false, and title `DoTodo Tauri Spike`. Reproduce the same three tasks using only local HTML and CSS.

- [ ] **Step 3: Add native tray and smoke-test behavior**

Create Show and Exit tray items. When `--smoke-test` is present, close after the measurement interval without persisting state.

- [ ] **Step 4: Build Release and record output**

Run: `cargo tauri build --no-bundle` from `spikes/tauri`.

Expected: exit code 0 and the release executable under `src-tauri/target/release/`.

- [ ] **Step 5: Smoke-test the process**

Start the executable, confirm the window title, capture the process tree working set after 10 seconds, and allow the smoke timer to exit it.

### Task 3: Reproducible comparison

**Files:**
- Create: `tools/Measure-Spikes.ps1`
- Create: `docs/research/windows-stack-spike-results.md`

**Interfaces:**
- Consumes: exact artifact paths produced by Tasks 1 and 2.
- Produces: a UTF-8 Markdown table with bytes, MiB, process working set, runtime dependencies, and observed window behavior.

- [ ] **Step 1: Write the measurement script**

Define `Measure-Artifact([string]$Name, [string]$Path, [string]$Runtime)` and fail if an expected artifact is missing. Use `Get-Item` for bytes and `Get-Process` for process working set.

- [ ] **Step 2: Run both smoke tests and measurements**

Run: `powershell -ExecutionPolicy Bypass -File tools/Measure-Spikes.ps1`

Expected: both rows contain non-zero artifact and working-set values.

- [ ] **Step 3: Write the decision report**

Record commands, exact versions, artifact sizes, working-set caveats, platform-code differences, dependency assumptions, and the winning stack using the spec's decision rule.

- [ ] **Step 4: Validate the report and disposable boundary**

Run: `git diff --check` and `rg "spikes/" src app -g "*"` when the production directory exists.

Expected: no whitespace errors and no production import of a spike path.

