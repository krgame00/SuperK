# Smart Desktop Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a one-click Smart Desktop Launcher (`SuperK-Launcher.vbs`) and desktop shortcut that self-heals by bootstrapping offline services (Python `:8765` + Next.js `:3000`) before opening a dedicated frameless app window (`--app=http://127.0.0.1:3000`), and cleaning up stale shortcuts.

**Architecture:** A native Windows VBScript launcher checks port readiness via MSXML2/WinHttp, starts background services silently if offline, polls until ready, and launches Chromium in app mode. A Node.js setup script manages the Windows Desktop shortcut creation and cleans up obsolete shortcuts.

**Tech Stack:** VBScript (`wscript.exe`), Node.js (`mjs`), Windows Shell Scripting, Vitest.

## Global Constraints
- Must not flash persistent black console windows during standard desktop launch.
- Must be idempotent: if services are already running, launch the app window immediately without spawning duplicate processes.
- Must support fallback if Chrome is not installed (check Edge, Brave, or system default browser).
- Must preserve `stop.bat` as the safe process shutdown tool.

---

### Task 1: Create Unit Test for Launcher Script Logic & Browser Discovery

**Files:**
- Create: `tests/scripts/desktopLauncher.test.ts`

**Interfaces:**
- Produces: Test suite validating browser executable search paths, port probe logic, and VBScript syntax integrity.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("SuperK Smart Desktop Launcher", () => {
  const rootDir = process.cwd();
  const launcherPath = path.join(rootDir, "SuperK-Launcher.vbs");
  const setupScriptPath = path.join(rootDir, "scripts", "create-desktop-shortcut.mjs");

  it("ensures SuperK-Launcher.vbs exists and contains core health check and app mode flags", () => {
    expect(fs.existsSync(launcherPath)).toBe(true);
    const content = fs.readFileSync(launcherPath, "utf-8");
    expect(content).toContain("127.0.0.1:3000");
    expect(content).toContain("127.0.0.1:8765");
    expect(content).toContain("--app=");
    expect(content).toContain("wscript.exe");
  });

  it("ensures create-desktop-shortcut.mjs exists and targets SuperK-Launcher.vbs", () => {
    expect(fs.existsSync(setupScriptPath)).toBe(true);
    const content = fs.readFileSync(setupScriptPath, "utf-8");
    expect(content).toContain("SuperK-Launcher.vbs");
    expect(content).toContain("SuperK Manga Translator.lnk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/desktopLauncher.test.ts`
Expected: FAIL with "expected false to be true" (files not created yet).

- [ ] **Step 3: Implement minimal files placeholder to verify test wiring**

Create empty or skeleton files for `SuperK-Launcher.vbs` and `scripts/create-desktop-shortcut.mjs`.

- [ ] **Step 4: Commit test skeleton**

```bash
git add tests/scripts/desktopLauncher.test.ts
git commit -m "test: add desktop launcher test suite"
```

---

### Task 2: Implement `SuperK-Launcher.vbs`

**Files:**
- Create/Modify: `SuperK-Launcher.vbs`
- Modify: `start.bat`

**Interfaces:**
- Consumes: `ocr-service/venv/Scripts/uvicorn.exe`, `npm run dev`, `http://127.0.0.1:3000`, `http://127.0.0.1:8765/health`.
- Produces: Seamless execution opening `http://127.0.0.1:3000` in Chromium app mode or default browser.

- [ ] **Step 1: Write `SuperK-Launcher.vbs` with idempotent port check & browser detection**

```vbscript
Option Explicit
Dim WshShell, FSO, scriptDir, http, uvicornExe, fCache
Dim isFrontendRunning, isBackendRunning, attempts, maxAttempts, url, browserPath

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' 1. Cache setup if drive F:\ exists
If FSO.FolderExists("F:\") Then
    fCache = "F:\manga-cache"
    If Not FSO.FolderExists(fCache & "\ocr-jobs") Then FSO.CreateFolder(fCache & "\ocr-jobs")
    If Not FSO.FolderExists(fCache & "\paddle") Then FSO.CreateFolder(fCache & "\paddle")
    If Not FSO.FolderExists(fCache & "\torch") Then FSO.CreateFolder(fCache & "\torch")
    If Not FSO.FolderExists(fCache & "\huggingface") Then FSO.CreateFolder(fCache & "\huggingface")
    If Not FSO.FolderExists(fCache & "\temp") Then FSO.CreateFolder(fCache & "\temp")
    
    WshShell.Environment("PROCESS")("SUPERK_CACHE_DIR") = fCache & "\ocr-jobs"
    WshShell.Environment("PROCESS")("PADDLE_HOME") = fCache & "\paddle"
    WshShell.Environment("PROCESS")("TORCH_HOME") = fCache & "\torch"
    WshShell.Environment("PROCESS")("HF_HOME") = fCache & "\huggingface"
    WshShell.Environment("PROCESS")("TEMP") = fCache & "\temp"
End If

' 2. Locate uvicorn.exe
uvicornExe = scriptDir & "\ocr-service\venv\Scripts\uvicorn.exe"
If Not FSO.FileExists(uvicornExe) Then
    uvicornExe = scriptDir & "\ocr-service\.venv\Scripts\uvicorn.exe"
End If

' 3. Helper to check URL health
Function CheckUrl(testUrl)
    On Error Resume Next
    Dim xmlHttp
    Set xmlHttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    xmlHttp.setTimeouts 800, 800, 800, 800
    xmlHttp.Open "GET", testUrl, False
    xmlHttp.Send
    If Err.Number = 0 And xmlHttp.Status < 400 Then
        CheckUrl = True
    Else
        CheckUrl = False
    End If
    Set xmlHttp = Nothing
    On Error GoTo 0
End Function

isFrontendRunning = CheckUrl("http://127.0.0.1:3000")
isBackendRunning = CheckUrl("http://127.0.0.1:8765/health")

' 4. Start missing services silently
If Not isBackendRunning Then
    WshShell.CurrentDirectory = scriptDir & "\ocr-service"
    WshShell.Run """" & uvicornExe & """ app.api:app --host 127.0.0.1 --port 8765", 0, False
End If

If Not isFrontendRunning Then
    WshShell.CurrentDirectory = scriptDir
    WshShell.Run "cmd.exe /c npm run dev", 0, False
End If

' 5. Wait for frontend to be ready if it was started
If Not isFrontendRunning Then
    attempts = 0
    maxAttempts = 30
    Do While attempts < maxAttempts
        WScript.Sleep 1000
        If CheckUrl("http://127.0.0.1:3000") Then
            Exit Do
        End If
        attempts = attempts + 1
    Loop
End If

' 6. Detect Chromium browser for app mode
url = "http://127.0.0.1:3000"
browserPath = ""

Dim candidates, cPath
candidates = Array( _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\BraveSoftware\Brave-Browser\Application\brave.exe", _
    WshShell.ExpandEnvironmentStrings("%LocalAppData%") & "\BraveSoftware\Brave-Browser\Application\brave.exe" _
)

For Each cPath In candidates
    If FSO.FileExists(cPath) Then
        browserPath = cPath
        Exit For
    End If
Next

If browserPath <> "" Then
    WshShell.Run """" & browserPath & """ --app=" & url, 1, False
Else
    WshShell.Run "cmd.exe /c start " & url, 0, False
End If
```

- [ ] **Step 2: Update `start.bat` to invoke `SuperK-Launcher.vbs`**

Modify `start.bat` so invoking it runs `SuperK-Launcher.vbs` directly without a hanging prompt.

- [ ] **Step 3: Run vitest to verify Task 1 test passes**

Run: `npx vitest run tests/scripts/desktopLauncher.test.ts`
Expected: PASS for Task 1 tests.

- [ ] **Step 4: Commit Task 2 changes**

```bash
git add SuperK-Launcher.vbs start.bat
git commit -m "feat: implement SuperK smart desktop launcher script"
```

---

### Task 3: Implement Shortcut Setup Script & Cleanup

**Files:**
- Create: `scripts/create-desktop-shortcut.mjs`

**Interfaces:**
- Produces: Updates `C:\Users\PC\Desktop\SuperK Manga Translator.lnk` and removes stale shortcuts.

- [ ] **Step 1: Write `scripts/create-desktop-shortcut.mjs`**

```javascript
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = process.cwd();
const launcherVbs = path.join(rootDir, "SuperK-Launcher.vbs");
const userProfile = process.env.USERPROFILE || "C:\\Users\\PC";
const desktopDir = path.join(userProfile, "Desktop");
const shortcutPath = path.join(desktopDir, "SuperK Manga Translator.lnk");
const staleShortcut = path.join(desktopDir, "start - Shortcut.lnk");

// Determine icon path (favicon or dedicated icon)
let iconPath = path.join(rootDir, "public", "favicon.ico");
if (!fs.existsSync(iconPath)) {
  iconPath = path.join(rootDir, "public", "icon.png");
}

console.log(`Setting up Desktop Shortcut: ${shortcutPath}`);

// PowerShell command to create/update shortcut using WScript.Shell COM object
const psCommand = `
$sh = New-Object -ComObject WScript.Shell;
$shortcut = $sh.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}");
$shortcut.TargetPath = "wscript.exe";
$shortcut.Arguments = "\\"${launcherVbs.replace(/\\/g, "\\\\")}\\"";
$shortcut.WorkingDirectory = "${rootDir.replace(/\\/g, "\\\\")}";
$shortcut.Description = "SuperK Manga Translator - One-Click Launcher";
if (Test-Path "${iconPath.replace(/\\/g, "\\\\")}") {
    $shortcut.IconLocation = "${iconPath.replace(/\\/g, "\\\\")}, 0";
}
$shortcut.Save();
`;

execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/\n/g, " ")}"`, {
  stdio: "inherit",
});

// Clean up stale shortcuts
if (fs.existsSync(staleShortcut)) {
  try {
    fs.unlinkSync(staleShortcut);
    console.log(`Removed stale shortcut: ${staleShortcut}`);
  } catch (err) {
    console.warn(`Could not remove ${staleShortcut}: ${err.message}`);
  }
}

console.log("Successfully created/updated Desktop Shortcut!");
```

- [ ] **Step 2: Run the shortcut creation script**

Run: `node scripts/create-desktop-shortcut.mjs`
Expected: Output confirms `SuperK Manga Translator.lnk` updated and stale shortcut deleted.

- [ ] **Step 3: Verify Desktop shortcut properties using PowerShell**

Check TargetPath is `wscript.exe`, Arguments contain `SuperK-Launcher.vbs`.

- [ ] **Step 4: Commit shortcut script**

```bash
git add scripts/create-desktop-shortcut.mjs
git commit -m "feat: add desktop shortcut creation and cleanup script"
```

---

### Task 4: End-to-End Verification & Documentation

**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [ ] **Step 1: Run full test suites**

Run:
- `npx vitest run tests/scripts`
- `npx vitest run tests/translation`
- `npx tsc --noEmit`

- [ ] **Step 2: End-to-end launch verification**

Run `cscript.exe SuperK-Launcher.vbs` and verify:
- Backend (`http://127.0.0.1:8765/health`) and Frontend (`http://127.0.0.1:3000`) respond OK.
- App window opens cleanly.

- [ ] **Step 3: Update `docs/AI-WORKING-NOTES.md`**

Record `VERIFIED WORKING` with test and runtime evidence.

- [ ] **Step 4: Commit documentation and working notes**

```bash
git add docs/AI-WORKING-NOTES.md
git commit -m "docs: record smart desktop launcher verification in working notes"
```
