# DoTodo Electron Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped Electron daily todo for Windows and macOS while teaching the user Electron architecture and practical JavaScript through runnable lessons and exercises.

**Architecture:** The Electron main process owns the trusted application state, filesystem and native OS integrations. A sandboxed preload exposes a narrow command API to a DOM-only renderer; pure CommonJS domain and storage modules remain independently testable with Node's built-in test runner.

**Tech Stack:** Electron 44, Node.js 22, vanilla JavaScript, HTML, CSS, `node:test`, electron-builder 26.

**Spec:** `docs/superpowers/specs/2026-09-12-dotodo-electron-cross-platform-design.md`

## Post-acceptance revisions

Recorded here rather than rewritten into the steps above, so the plan still shows what was intended
before the first run of the real application.

**R1 — The background alpha became a fixed constant.** The plan and spec called for a 55%–100%
opacity slider that touched only the glass surface. Layering was implemented correctly, but a slider
still lets the user destroy legibility: at 55% over a bright wallpaper the light text loses contrast
even though it is not faded. The slider is gone; `--surface-opacity` is gone; the surface is a fixed
`rgba(28, 28, 30, 0.88)`. `setBackgroundOpacity` is removed from the preload API.

**R2 — The palette is near-monochrome.** The dark navy `#0c1424` picked up the wallpaper's hue and
read as "a blue window" instead of glass. The surface is now neutral grey, the accents are grey/white,
and the only remaining colour is a desaturated grey-green for completed items.

**R3 — Platform caveats moved out of the UI.** `setWindowMode('desktop')` still returns a truthful
`notice`, but `ipc.js` no longer forwards it: a one-time fact belongs in the README, not in a toast
that repeats on every switch.

**R4 — Shortcut collisions degrade silently.** A failed `globalShortcut.register` no longer adds a
runtime warning. It is a non-fatal degradation, and the warning used to occupy an absolutely
positioned banner that covered the page heading.

**R5 — Smaller noise removals.** The `Ctrl N` hint in the tab bar and the "延续" badge on Today rows
are gone. The runtime warning band moved from absolute positioning into row 1 of the app grid so it
can never overlap the heading.

**R6 — A screenshot harness now exists.** `tools/capture-window.js` renders the real window against a
chosen backdrop and writes a PNG, which is how R1–R5 were verified. The agent sandbox could not start
Electron before this.


## Global Constraints

- Keep `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Do not add React, Vue, TypeScript, a database, or a frontend bundler.
- New tasks belong only to the local Today; rollover archives without carrying unfinished tasks.
- A historical task can be continued to Today at most once for its lifetime.
- Renderer code never imports Node or Electron and never writes trusted state directly.
- Background opacity changes the glass surface only; text and controls remain fully opaque.
- Windows is implemented and verified first; macOS artifacts are built and manually verified on macOS or a macOS CI runner.
- No installer or GitHub publication before user acceptance.
- Every task ends with tests, a learning chapter, exercises, and a focused commit.

## Planned File Structure

```text
src/
  main.js                    Electron lifecycle composition root
  preload.js                 contextBridge allowlist
  domain/
    daily-todo-engine.js     Pure daily task state transitions
    state-schema.js          State creation, cloning, validation
  infrastructure/
    json-state-store.js      Atomic JSON persistence and recovery
  electron/
    ipc.js                   Validated IPC handlers
    window-controller.js     BrowserWindow lifecycle and bounds
    shell-controller.js      Tray, shortcut, login item, window mode
  renderer/
    index.html               Semantic application shell
    app.js                   DOM event wiring and snapshot rendering
    styles.css               Dark glass visual system
test/
  domain/*.test.js
  infrastructure/*.test.js
  electron/*.test.js
  renderer/*.test.js
docs/learning/electron/
  01-process-model.md ... 08-build-and-release.md
exercises/electron/
  01-process-model/README.md ... 08-build-and-release/README.md
```

---

### Task 1: Pure JavaScript State Schema and Daily Domain Engine

**Files:**
- Create: `src/domain/state-schema.js`
- Create: `src/domain/daily-todo-engine.js`
- Create: `test/domain/state-schema.test.js`
- Create: `test/domain/daily-todo-engine.test.js`
- Create: `docs/learning/electron/01-process-model-and-pure-domain.md`
- Create: `exercises/electron/01-process-model/README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `createState(localDate, nowIso)`, `validateState(value)`, `cloneState(value)`.
- Produces: `createDailyTodoEngine(initialState, { now, createId })` with `getSnapshot()`, `addTask(text)`, `editTask(id,text)`, `toggleTask(id)`, `reorderTask(id,targetIndex)`, `deleteTodayTask(id)`, `deleteHistoryTask(date,id)`, `undo(token)`, `continueTask(date,id)`, and `ensureCurrentDay(now)`.

- [x] **Step 1: Replace the legacy store test with failing schema tests**

```js
test('createState creates one open local day', () => {
  const state = createState('2026-09-13', '2026-09-13T08:00:00.000+08:00');
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.activeDay, { date: '2026-09-13', closedAt: null, tasks: [] });
  assert.deepEqual(state.history, []);
});
```

- [x] **Step 2: Run the schema test and observe the missing-module failure**

Run: `node --test test/domain/state-schema.test.js`

- [x] **Step 3: Implement the schema with explicit settings defaults**

```js
const DEFAULT_SETTINGS = Object.freeze({
  backgroundOpacity: 0.82,
  windowMode: 'topmost',
  closeToTray: true,
  launchAtLogin: false
});
```

- [x] **Step 4: Add failing domain tests for add/edit/toggle/reorder/delete/undo**

Use fixed `now()` and `createId()` functions; assert returned snapshots rather than internal arrays.

- [x] **Step 5: Implement immutable public snapshots and validated state transitions**

Every command returns `{ ok: true, snapshot }` or `{ ok: false, error, snapshot }`. No caller receives the engine's mutable state reference.

- [x] **Step 6: Add failing tests for rollover, clock rollback and one-time continuation**

```js
assert.equal(engine.ensureCurrentDay('2026-09-14T00:00:01+08:00').rolledOver, true);
assert.equal(engine.getSnapshot().history[0].date, '2026-09-13');
assert.equal(engine.continueTask('2026-09-13', sourceId).ok, true);
assert.equal(engine.continueTask('2026-09-13', sourceId).ok, false);
```

- [x] **Step 7: Implement rollover and reciprocal continuation metadata**

Deletion clears live reciprocal IDs but preserves `hasBeenContinued`; undo restores reciprocal links only when the counterpart exists.

- [x] **Step 8: Run all domain tests**

Run: `node --test test/domain/*.test.js`
Expected: all pass.

- [x] **Step 9: Write lesson 01 and its hand-written exercises**

The lesson explains pure functions, closures, dependency injection, object/array methods, defensive cloning and why Electron-independent domain code is easier to test. Exercises require implementing `clamp`, `findTask`, `moveItem`, and a simplified rollover function without copying production code.

- [x] **Step 10: Commit Task 1**

```bash
git add package.json src/domain test/domain docs/learning/electron/01-process-model-and-pure-domain.md exercises/electron/01-process-model
git commit -m "feat: build JavaScript daily todo domain"
```

### Task 2: Resilient JSON Persistence

**Files:**
- Create: `src/infrastructure/json-state-store.js`
- Create: `test/infrastructure/json-state-store.test.js`
- Create: `docs/learning/electron/02-node-files-and-json.md`
- Create: `exercises/electron/02-storage/README.md`
- Delete after replacement: `src/store.js`
- Delete after replacement: `test/store.test.js`

**Interfaces:**
- Consumes: `validateState(value)`, `cloneState(value)`.
- Produces: `new JsonStateStore(directory)` with `load()`, `save(state)`, `importFrom(sourcePath)`, `exportTo(destinationPath,state)`, `getPaths()`.

- [x] **Step 1: Write failing save/load round-trip and reference-isolation tests**

Use a unique directory under `os.tmpdir()` and remove only that exact directory in test cleanup.

- [x] **Step 2: Run the storage test and verify the module is missing**

Run: `node --test test/infrastructure/json-state-store.test.js`

- [x] **Step 3: Implement load and atomic save**

Write `state.tmp.json`, fsync/close it, rotate `state.json` to `state.backup.json`, and rename the temporary file to `state.json`.

- [x] **Step 4: Add failing recovery tests**

Cover missing primary, valid backup, corrupt primary, corrupt primary plus backup, and failure to preserve corrupt files.

- [x] **Step 5: Implement recovery without overwriting evidence**

Return `{ state, warning, preservedCorruptFiles, writable }`. If corrupt files cannot be preserved, block future save attempts.

- [x] **Step 6: Add failing import/export tests**

Invalid imports must leave both memory and disk unchanged; valid imports must preserve the prior state as a backup.

- [x] **Step 7: Implement import/export and rerun all storage tests**

Run: `node --test test/infrastructure/*.test.js`

- [x] **Step 8: Write lesson 02 and storage exercises**

Teach `fs`, `path`, async failure boundaries, JSON serialization, atomic replacement and backup semantics. Exercises implement a safe JSON reader and explain why writing directly to `state.json` can corrupt data.

- [x] **Step 9: Remove the superseded legacy store and commit**

```bash
git add src/infrastructure test/infrastructure docs/learning/electron/02-node-files-and-json.md exercises/electron/02-storage src/store.js test/store.test.js
git commit -m "feat: add resilient Electron state storage"
```

### Task 3: Secure Main, Preload and IPC Boundary

**Files:**
- Create: `src/electron/ipc.js`
- Create: `src/electron/window-controller.js`
- Create: `test/electron/ipc.test.js`
- Rewrite: `src/main.js`
- Rewrite: `src/preload.js`
- Create: `docs/learning/electron/03-main-preload-renderer.md`
- Create: `exercises/electron/03-ipc/README.md`

**Interfaces:**
- Consumes: domain engine and store.
- Produces: `registerIpc({ ipcMain, engine, store, dialogs, shell })` returning `dispose()`.
- Produces renderer API: `getSnapshot`, task commands, settings commands, import/export, open data folder, and window commands.

- [x] **Step 1: Write failing IPC tests with a recording `ipcMain` adapter**

Assert exact channel names and reject malformed IDs, dates, indices, text and settings before calling the engine.

- [x] **Step 2: Run IPC tests and observe the missing registration module**

Run: `node --test test/electron/ipc.test.js`

- [x] **Step 3: Implement IPC registration with a fixed channel map**

No handler accepts a method name from the renderer. Each handler validates its own primitive input and returns serializable results.

- [x] **Step 4: Rewrite Preload as a narrow contextBridge**

```js
contextBridge.exposeInMainWorld('dotodo', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('state:get-snapshot'),
  addTask: (text) => ipcRenderer.invoke('task:add', text)
}));
```

- [x] **Step 5: Rewrite main composition root**

Create the store after `app.whenReady()`, load or create state, ensure the current day, create the engine, register IPC, and then show the window after its first completed load.

- [x] **Step 6: Add security assertions**

Verify BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; deny unexpected navigation and new windows.

- [x] **Step 7: Run tests and Electron smoke mode**

Run: `node --test test/domain/*.test.js test/infrastructure/*.test.js test/electron/*.test.js`
Run: `npm run smoke`

- [x] **Step 8: Write lesson 03 and IPC exercises**

Exercises ask the learner to classify APIs by process, add one safe read-only IPC call, and identify three unsafe preload examples.

- [x] **Step 9: Commit Task 3**

```bash
git add src/main.js src/preload.js src/electron test/electron docs/learning/electron/03-main-preload-renderer.md exercises/electron/03-ipc
git commit -m "feat: establish secure Electron process boundary"
```

### Task 4: Dark Glass Today Interface

**Files:**
- Move/Rewrite: `src/index.html` to `src/renderer/index.html`
- Move/Rewrite: `src/renderer.js` to `src/renderer/app.js`
- Move/Rewrite: `src/styles.css` to `src/renderer/styles.css`
- Create: `test/renderer/view-model.test.js`
- Create: `test/renderer/markup.test.js`
- Create: `src/renderer/view-model.js`
- Create: `docs/learning/electron/04-browser-window-and-glass-ui.md`
- Create: `exercises/electron/04-renderer/README.md`
- Modify: `src/electron/window-controller.js`

**Interfaces:**
- Consumes: `window.dotodo` API and state snapshots.
- Produces: `deriveTodayView(snapshot)` and DOM rendering for the Today page.

- [x] **Step 1: Define CSS tokens from the design document's visual section**

Use dark navy glass, cyan accent, mint completion, coral danger, 1px translucent borders and fully opaque foreground text.

- [x] **Step 2: Write failing renderer view-model tests**

Assert date label, completed/total counts, progress ratio, empty state and task row projection from a snapshot.

- [x] **Step 3: Implement the pure renderer view-model and pass tests**

Run: `node --test test/renderer/view-model.test.js`.

- [x] **Step 4: Build semantic Today HTML**

Use a draggable header, right-aligned layer/settings/minimize/close controls, progress, add form, task list, error area, undo area and Today/History tabs.

- [x] **Step 5: Implement glass CSS without whole-window opacity**

`BrowserWindow` stays transparent. A background pseudo-element receives `--surface-opacity`; the content subtree remains at opacity `1`.

Superseded by R1: the variable and the slider were both removed after the first real run. The
background pseudo-element now receives a fixed `var(--surface)`.

- [x] **Step 6: Wire Today commands and keyboard behavior**

Enter adds, Space toggles the selected task, F2/double-click edits, Delete removes, Escape cancels editing, and all results re-render from the returned snapshot.

- [x] **Step 7: Run renderer tests and smoke mode**

Run: `node test/renderer/view-model.test.js test/renderer/markup.test.js`
Run: `npm run smoke`

Note: today's deletion undo bar and the two-state layer toggle were wired here so the intermediate
build is not destructive; lesson 05 still owns the History page, drag reorder and full settings.
`npm run smoke` cannot run inside the agent sandbox (`spawn EPERM` on piped stdio) and is verified
by the user locally.

- [x] **Step 8: Write lesson 04 and renderer exercises**

Teach transparent BrowserWindow composition, CSS alpha versus window opacity, DOM creation, event delegation, accessibility names and `Array.prototype.map/filter/find` in UI projection.

- [x] **Step 9: Commit Task 4**

```bash
git add src/renderer src/electron/window-controller.js test/renderer docs/learning/electron/04-browser-window-and-glass-ui.md exercises/electron/04-renderer src/index.html src/renderer.js src/styles.css
git commit -m "feat: create dark glass Today interface"
```

### Task 5: History, Undo, Drag Reorder and Settings

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/view-model.js`
- Modify: `test/renderer/view-model.test.js`
- Create: `docs/learning/electron/05-state-driven-interactions.md`
- Create: `exercises/electron/05-interactions/README.md`

**Interfaces:**
- Consumes: task/history/settings commands from Preload.
- Produces: date-grouped History, six-second undo UI, pointer drag reordering and a right-anchored settings popover.

- [x] **Step 1: Add failing history/settings projection tests**

Assert descending dates, continuation button visibility, continuation label, opacity percentage and selected window mode.

- [x] **Step 2: Implement History and Settings projection functions**

The continuation action is hidden when completed, `hasBeenContinued`, or currently linked.

- [x] **Step 3: Render History with read-only rows**

Only delete and continue actions are interactive; historical text, checkbox state and order cannot be edited.

- [x] **Step 4: Implement the six-second undo bar**

Use one renderer timer for visibility while the main-process engine owns token validity.

- [x] **Step 5: Implement pointer-based drag reorder**

Start only from a dedicated handle, clear the candidate on pointer up/cancel/leave, and send task ID plus target index after drop.

- [x] **Step 6: Implement the right-top settings popover**

This stage ships background opacity and the normal/topmost layer control. Close-to-tray, launch at
login and the `desktop` layer arrive with the native shell in Task 6, so the popover never shows a
switch that cannot work yet.

The close control sits in the popover's top-right grid cell. Background opacity displays a percentage and updates only `--surface-opacity`.

- [x] **Step 7: Run renderer and full Node tests**

Run: `npm test`

- [x] **Step 8: Write lesson 05 and interaction exercises**

Teach event propagation, pointer events, timers, derived UI state, optimistic versus authoritative updates, and implementing a small drag state machine by hand.

- [x] **Step 9: Commit Task 5**

```bash
git add src/renderer test/renderer docs/learning/electron/05-state-driven-interactions.md exercises/electron/05-interactions
git commit -m "feat: add history settings and task interactions"
```

### Task 6: Tray, Global Shortcut, Window Modes and Login Item

**Files:**
- Create: `src/electron/shell-controller.js`
- Create: `test/electron/shell-controller.test.js`
- Modify: `src/main.js`
- Modify: `src/electron/ipc.js`
- Modify: `build/icon.svg`
- Create: `docs/learning/electron/06-native-shell.md`
- Create: `exercises/electron/06-native-shell/README.md`

**Interfaces:**
- Produces: `createShellController({ app, BrowserWindow, Tray, Menu, globalShortcut, platform })` with `initialize`, `setWindowMode`, `setLaunchAtLogin`, `toggleVisibility`, and `dispose`.

- [x] **Step 1: Write failing shell-controller tests with Electron adapters**

Assert tray menu actions, shortcut collision reporting, close-to-tray behavior, normal/topmost mode mapping and disposal.

- [x] **Step 2: Implement tray and global shortcut lifecycle**

Register after `ready`, unregister during `will-quit`, and keep the tray object strongly referenced.

- [x] **Step 3: Implement normal and topmost window modes**

Use `setAlwaysOnTop(false)` for normal and `setAlwaysOnTop(true, 'floating')` for topmost.

- [x] **Step 4: Implement the desktop-mode platform seam**

On Windows, preserve the public `WindowMode` contract and place native Z-order behavior behind a replaceable adapter. On macOS, document and expose the closest verified behavior rather than pretending identical semantics.

- [x] **Step 5: Implement login-item reconciliation**

Call `app.setLoginItemSettings`, read back effective settings where supported, roll back persisted UI state on failure, and explain macOS signing limitations.

- [x] **Step 6: Run shell tests and smoke mode**

Run: `node test/electron/shell-controller.test.js`
Run: `npm run smoke`

Note: the smoke run is verified by the user locally; the agent sandbox cannot spawn Electron.
The tray icon is a generated bitmap (`npm run icons`) because `Tray` does not accept SVG.

Run: `node --test test/electron/*.test.js`
Run: `npm run smoke`

- [x] **Step 7: Write lesson 06 and native-shell exercises**

Teach Electron lifecycle events, retained object references, accelerators, tray differences, login items and platform feature detection.

- [x] **Step 8: Commit Task 6**

```bash
git add src/electron src/main.js test/electron build/icon.svg docs/learning/electron/06-native-shell.md exercises/electron/06-native-shell
git commit -m "feat: integrate Electron native desktop shell"
```

### Task 7: Import, Export, Recovery UX and Runtime Verification

**Files:**
- Modify: `src/electron/ipc.js`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/index.html`
- Create: `tools/verify-electron.ps1`
- Create: `docs/testing/electron-windows-manual-checklist.md`
- Create: `docs/learning/electron/07-debug-test-verify.md`
- Create: `exercises/electron/07-testing/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: store import/export and shell APIs.
- Produces: repeatable `npm run verify:win` validation.

- [x] **Step 1: Add IPC tests for dialog cancellation, invalid import and export failure**

Use injected dialog and shell adapters; never automate native dialogs in unit tests.

- [x] **Step 2: Implement import/export/open-folder IPC and UI feedback**

The IPC layer already handled cancellation and rejection correctly, so this step added the settings
panel entries, an info tone for success messages, and startup warnings that name the exact preserved
corrupt-file paths.

Surface exact preserved corrupt-file paths and keep current in-memory state unchanged after invalid import.

- [x] **Step 3: Add a deterministic smoke mode**

Use an isolated temporary user-data directory, load the renderer, report readiness and exit with code `0`; do not touch real user data.

- [x] **Step 4: Write the Windows verification script**

`tools/verify-electron.ps1` targets Windows PowerShell 5.1 (this machine has no `pwsh`) and is saved
as UTF-8 with BOM, because 5.1 reads BOM-less scripts using the system ANSI code page. Verified end
to end for the environment, size-classification and summary steps; the test and smoke steps run only
on a machine that can start Electron.

The script runs `npm test`, smoke, packaged-directory build, file inventory, installer-independent unpacked size and idle memory measurement.

- [x] **Step 5: Write the manual acceptance checklist**

Cover Windows 10/11, 100%/150%/mixed DPI, multiple monitors, tray, shortcut collision, Explorer restart, login item, rollover and data recovery.

- [x] **Step 6: Run complete automated verification**

Run: `npm run verify:win`
Expected: all tests pass, smoke exits `0`, and size figures are reported by category.

Partially verified: the script itself runs and reports categories and failures correctly, but
`npm test` and `npm run smoke` hit the agent sandbox's `spawn EPERM` boundary. The user runs the full
pipeline locally.

Later, with full access granted, the whole pipeline ran green end to end — exit code 0, all six
steps passing (environment, npm test, smoke, pack, size classification, idle memory). Two real
failures were fixed along the way: the Electron archive download needs a mirror on a restricted
network, and the memory step's process guard only looked for `DoTodo` while a development run is
named `electron`.

- [x] **Step 7: Write lesson 07 and testing exercises**

Teach unit/integration/smoke/manual test boundaries, test doubles, deterministic clocks, temporary directories and reading process memory.

- [x] **Step 8: Commit Task 7**

```bash
git add src package.json tools docs/testing docs/learning/electron/07-debug-test-verify.md exercises/electron/07-testing test
git commit -m "test: add Electron recovery and verification workflow"
```

### Task 8: Repository Cleanup and Learning Index

**Files:**
- Delete: superseded root renderer/store files if still present
- Delete: obsolete WPF-only research and spike documents from `main` after extracting durable lessons
- Create: `docs/learning/electron/README.md`
- Create: `docs/learning/electron/08-build-and-release.md`
- Create: `exercises/electron/README.md`
- Create: `exercises/electron/08-build-and-release/README.md`
- Rewrite: `README.md`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: one clear Electron repository entry point and a sequential course index.

- [x] **Step 1: Inventory tracked and generated content**

Classified every tracked file as source, test, course, packaging, docs or generated. `git ls-files`
now contains no generated entry, and `git status --ignored --short` reports only `node_modules/`,
`release/`, `.worktrees/` and `.superpowers/`.

- [x] **Step 2: Extract any durable WPF comparison lessons**

`docs/learning/electron/appendix-desktop-stack-and-packaging.md` keeps what still helps an Electron
reader: the "floating on the desktop is not one technique" finding, the five-stack comparison table,
where Electron's size actually comes from (with measured numbers), the five-stage build pipeline, the
EXE/MSI/MSIX/DMG distinctions, and the pre-release size audit checklist. WPF-specific steps are gone.

- [x] **Step 3: Remove superseded tracked files with exact paths**

Removed `docs/research/windows-desktop-todo-architecture.md`,
`docs/superpowers/plans/2026-09-11-dotodo-stack-spike.md` and
`docs/superpowers/specs/2026-09-11-dotodo-stack-spike-design.md` after moving their durable content
into the appendix.

- [ ] **Step 4: Remove generated release output and local WPF worktree safely**

Deferred to the user. These are the only irreversible actions left, and they touch 1.7 GB of local
state rather than anything tracked:

| 目标 | 大小 | 命令 | 为什么先不动 |
| --- | --- | --- | --- |
| `release/` | 473.9 MB | `Remove-Item -Recurse -Force release` | 里面是旧版 v1 安装器，重建需要再跑一次 `npm run dist:win` |
| `.worktrees/electron-v1` | 449.2 MB | `git worktree remove .worktrees/electron-v1` | 分支 `codex/electron-v1` 已全部快进合入 `main`，删除工作树不丢历史 |
| `.worktrees/windows-v1` | 1275.6 MB | `git worktree remove .worktrees/windows-v1` | 分支 `feature/windows-v1` 有 8 个未合并提交，是唯一的 WPF 实现记录 |

First verify absolute paths are inside `F:\杂\转开发\DoTodo` before running any of them. Delete
`.worktrees/windows-v1` only after Windows acceptance, and keep the branch until permanent branch
deletion is separately approved.

Run: `git worktree list` to confirm the current state.

- [x] **Step 5: Write the learning and exercise indexes**

`docs/learning/electron/README.md` maps all nine chapters plus the appendix, each with its source
files, expected duration, exercise count and grading command. `exercises/electron/README.md` indexes
the eight exercise sets (44 questions, 87 grading assertions) and explains why they stay out of
`npm test`.

- [x] **Step 6: Rewrite README for learners and users**

The README now splits the two audiences up front, documents the data location and file meanings,
lists every command, and states the platform status honestly: Windows is implemented with a manual
acceptance checklist, macOS has the code paths but has never been built or verified.

- [x] **Step 7: Run repository verification**

Run: `git status --short` — clean.
Run: `git status --ignored --short` — only ignore rules, no untracked surprises.
Run: `npm test` — all suites pass.

- [x] **Step 8: Commit Task 8**

```bash
git add -A
git commit -m "docs: finalize Electron learning workspace"
```

### Task 9: User Acceptance, Windows Installer and macOS Release Path

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/release.yml` only when GitHub publication is authorized
- Create: `docs/learning/electron/09-packaging-and-signing.md`
- Create: `docs/release/windows-release-checklist.md`
- Create: `docs/release/macos-release-checklist.md`

**Interfaces:**
- Consumes: accepted Electron application and electron-builder configuration.
- Produces: Windows NSIS `.exe`; later macOS `.app`, `.dmg`, ZIP and GitHub Release artifacts.

- [ ] **Step 1: Complete Windows manual acceptance with the user**

Blocked on the user: every stage from Task 4 onward produced interface behaviour that no automated
test can confirm. Walk `docs/testing/electron-windows-manual-checklist.md` (11 groups, ~80 items) and
report any finding before packaging starts. Do not treat this step as done because the tests pass.

- [x] **Step 2: Build the Windows NSIS installer**

Run: `npm run dist:win`. Record installer size separately from `win-unpacked` size.

**Done.** `release/DoTodo-Setup-1.0.0-x64.exe` — installer download 106.3 MB, packaged directory
367.4 MB, `app.asar` 119.7 KB. The first attempt failed on an aborted Electron archive download;
setting `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` to the npmmirror mirrors fixed it and
is now documented in the README and lesson 09.

Verified as part of this step:

- `app.asar` contains exactly 22 entries — `src/` (18), `assets/` (2 tray bitmaps) and `package.json`.
  No test, docs, exercises, tools or node_modules entry leaked in.
- The packaged executable was launched against an isolated data directory and screenshotted; it
  renders identically to the development build, which proves the asar resource paths (renderer page
  and tray bitmap) resolve in the shipped form.

- [ ] **Step 3: Install, launch, upgrade and uninstall on Windows**

Checklist written and waiting: `docs/release/windows-release-checklist.md` section 5. Must be done on
a clean Windows machine or VM — leftovers from the development machine hide most upgrade problems.

- [x] **Step 4: Explain and configure code signing without storing secrets**

Documented in lesson 09 and in section 6 of the Windows checklist: what signing buys, why an unsigned
build shows 未知发布者, how CI should carry the certificate through Secrets, and the `git log` check
that proves no certificate ever entered the repository.

- [ ] **Step 5: Build and verify macOS artifacts on macOS**

Run: `npm run dist:mac` on Intel/Apple Silicon or a macOS CI runner; verify `.app`, `.dmg`, ZIP, login item, tray/menu bar and notarization.

Blocked: this project has never been built or run on macOS. `docs/release/macos-release-checklist.md`
lists every step as pending, including five items that are expected to need code changes (menu-bar
template image, Dock menu, `openAsHidden`, macOS quit semantics, about panel).

- [x] **Step 6: Write lesson 09 and packaging exercises**

`docs/learning/electron/09-packaging-and-signing.md` covers the acceptance gate, the five packaging
stages, NSIS configuration, the three size numbers, signing versus notarization, the macOS login-item
limitation, the CI design, and the download failures you can hit offline.

The packaging exercises live in `exercises/electron/08-build-and-release/` rather than a second set:
artifact-name expansion, target flattening, size comparison, artifact sorting, path classification
and release-plan diffing. `README.md` links there.

- [ ] **Step 7: Publish to GitHub only after explicit approval**

Blocked on explicit approval. `.github/workflows/release.yml` is ready (tests before packaging,
installer-only artifacts, tag-gated release step, Secrets for signing) but nothing has been pushed and
no release exists.

- [x] **Step 8: Commit release configuration**

```bash
git add package.json .github/workflows/release.yml docs/release docs/learning/electron/09-packaging-and-signing.md
git commit -m "build: prepare signed cross-platform releases"
```
