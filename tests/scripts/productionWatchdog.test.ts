// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const watchdog = path.join(process.cwd(), "scripts", "production-watchdog.ps1");
const serviceStart = path.join(process.cwd(), "scripts", "service-start.ps1");
const supervisor = path.join(process.cwd(), "scripts", "start-production.ps1");
const stopServices = path.join(process.cwd(), "scripts", "stop-services.ps1");

function asArray(value: unknown): unknown[] {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function runPowerShell(command: string, timeout = 60000): any {
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout },
    ).trim(),
  );
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superk-watchdog-"));
  fs.mkdirSync(path.join(root, ".superk-runtime"), { recursive: true });
  // Real Test-Path must resolve the uvicorn venv for ocr restarts; Start-Process is mocked.
  fs.mkdirSync(path.join(root, "ocr-service", ".venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "ocr-service", ".venv", "Scripts", "uvicorn.exe"), "");
  return root;
}

const psQuote = (value: string) => value.replaceAll("'", "''");

function cycleCommand(root: string, body: string): string {
  return `
    $ErrorActionPreference = 'Stop'
    . '${psQuote(watchdog)}'
    $script:events = @()
    function Start-Process {
      param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru, [switch]$Wait)
      $script:events += [pscustomobject]@{ kind='process'; exe=$FilePath; args=$ArgumentList; style=$WindowStyle; stdout=$RedirectStandardOutput; stderr=$RedirectStandardError }
      return [pscustomobject]@{ Id=999; HasExited=$false; ExitCode=0 }
    }
    function Get-Command { param($Name) [pscustomobject]@{ Source='C:\\Node\\node.exe' } }
    $root = '${psQuote(root)}'
    $state = @{
      web = @{ restartTimestamps = [System.Collections.Generic.List[datetime]]::new() }
      ocr = @{ restartTimestamps = [System.Collections.Generic.List[datetime]]::new() }
    }
    ${body}
  `;
}

// Shaped to pass the real Test-SuperKServiceProcess ownership check against the temp root.
const ownedWebLine = "[pscustomobject]@{ ProcessId = 111; ExecutablePath = 'C:\\Node\\node.exe'; CommandLine = ('node.exe \"' + (Join-Path $root '.next\\standalone\\server.js') + '\"') }";
const ownedOcrLine = "[pscustomobject]@{ ProcessId = 112; ExecutablePath = (Join-Path $root 'ocr-service\\.venv\\Scripts\\uvicorn.exe'); CommandLine = 'uvicorn.exe app.api:app --port 8765' }";

test.skipIf(process.platform !== "win32")("restarts web when port 3000 is free and ocr is owned", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    function Get-SuperKPortOwner { param([int]$Port)
      if ($Port -eq 3000) { return $null }
      return ${ownedOcrLine}
    }
    $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ actions = $actions; events = $script:events } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.actions)).toEqual(["restart-web"]);
    const events = asArray(result.events) as { kind: string; args: string; style: string; stdout: string; stderr: string }[];
    expect(events).toHaveLength(1);
    expect(events[0].args).toContain("server.js");
    expect(events[0].style).toBe("Hidden");
    expect(events[0].stdout).toMatch(/\.superk-runtime\\web-\d{8}-\d{6}\.log$/);
    expect(events[0].stderr).toMatch(/web-error-\d{8}-\d{6}\.log$/);
    expect(events[0].stdout).not.toBe(events[0].stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("restarts ocr when port 8765 is free and web is owned", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    function Get-SuperKPortOwner { param([int]$Port)
      if ($Port -eq 8765) { return $null }
      return ${ownedWebLine}
    }
    $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ actions = $actions; events = $script:events } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.actions)).toEqual(["restart-ocr"]);
    const events = asArray(result.events) as { kind: string; args: string | string[]; style: string; stdout: string; stderr: string }[];
    expect(events).toHaveLength(1);
    expect(String(events[0].args)).toContain("app.api:app");
    expect(events[0].style).toBe("Hidden");
    expect(events[0].stdout).toMatch(/\.superk-runtime\\ocr-\d{8}-\d{6}\.log$/);
    expect(events[0].stderr).toMatch(/ocr-error-\d{8}-\d{6}\.log$/);
    expect(events[0].stdout).not.toBe(events[0].stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("skips the cycle while the launcher holds watchdog.pause", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    Set-Content -Path (Join-Path $root '.superk-runtime\\watchdog.pause') -Value 'pause'
    $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ actions = $actions; events = $script:events; webRestarts = $state.web.restartTimestamps.Count; ocrRestarts = $state.ocr.restartTimestamps.Count } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.actions)).toEqual(["skip-pause"]);
    expect(asArray(result.events)).toHaveLength(0);
    expect(result.webRestarts).toBe(0);
    expect(result.ocrRestarts).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("stands down when watchdog.stop exists", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    Set-Content -Path (Join-Path $root '.superk-runtime\\watchdog.stop') -Value 'stop'
    $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ actions = $actions; events = $script:events } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.actions)).toEqual(["stand-down"]);
    expect(asArray(result.events)).toHaveLength(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("leaves a foreign port owner alone and never restarts it", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    $foreign = [pscustomobject]@{ ProcessId = 777; ExecutablePath = 'C:\\Other\\thing.exe'; CommandLine = 'thing.exe --serve 8080' }
    function Get-SuperKPortOwner { param([int]$Port) return $foreign }
    $first = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    $second = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    function Get-SuperKPortOwner { param([int]$Port) return ${ownedWebLine} }
    $third = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ first = $first; second = $second; third = $third; events = $script:events } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.first)).toEqual(["skip-foreign", "skip-foreign"]);
    expect(asArray(result.second)).toEqual(["no-op"]);
    expect(asArray(result.third)).toEqual(["no-op"]);
    expect(asArray(result.events)).toHaveLength(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("gives up instead of restarting into a crash loop", () => {
  const root = makeTempRoot();
  try {
    const command = cycleCommand(root, `
    $script:popups = @()
    function New-Object { param($ComObject)
      $stub = [pscustomobject]@{}
      $stub | Add-Member -MemberType ScriptMethod -Name Popup -Value { param($Text, $Seconds, $Title, $Type) $script:popups += $Text; return 1 }
      $stub
    }
    for ($i = 0; $i -lt 5; $i++) { $state.ocr.restartTimestamps.Add([datetime]::UtcNow.AddMinutes(-1)) }
    function Get-SuperKPortOwner { param([int]$Port)
      if ($Port -eq 3000) { return ${ownedWebLine} }
      return $null
    }
    $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $root -ServiceState $state)
    [pscustomobject]@{ actions = $actions; events = $script:events; popups = $script:popups.Count } | ConvertTo-Json -Depth 5 -Compress
  `);
    const result = runPowerShell(command);
    expect(asArray(result.actions)).toEqual(["restart-ocr", "give-up"]);
    expect(asArray(result.events)).toHaveLength(0);
    expect(result.popups).toBe(1);
    const marker = path.join(root, ".superk-runtime", "watchdog-gave-up.txt");
    expect(fs.existsSync(marker)).toBe(true);
    const markerContent = fs.readFileSync(marker, "utf8");
    expect(markerContent).toContain("service: ocr");
    expect(markerContent).toContain("restarts:");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("real watchdog process stands down on a stop file and exits 0", () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, ".superk-runtime", "watchdog.stop"), "stop");
    const started = Date.now();
    // execFileSync throws on a non-zero exit, so reaching the assertions proves exit 0.
    // A unique mutex name keeps the test independent of the live production watchdog.
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", watchdog, "-ProjectRoot", root, "-MaxCycles", "2", "-IntervalSeconds", "1",
        "-MutexName", `Local\\SuperKWatchdogTest-${Date.now()}`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 60000 },
    );
    expect(Date.now() - started).toBeLessThan(20000);
    const logs = fs
      .readdirSync(path.join(root, ".superk-runtime"))
      .filter((name) => /^watchdog-\d{8}-\d{6}\.log$/.test(name));
    expect(logs).toHaveLength(1);
    const logContent = fs.readFileSync(path.join(root, ".superk-runtime", logs[0]), "utf8");
    expect(logContent).toContain("stand-down");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("touched production scripts parse cleanly", () => {
  const scripts = [serviceStart, watchdog, supervisor, stopServices];
  const command = `
    $out = @()
    foreach ($p in @('${scripts.map(psQuote).join("','")}')) {
      $tokens = $null
      $errors = $null
      [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors) | Out-Null
      $out += [pscustomobject]@{ path = $p; errors = @($errors | ForEach-Object { $_.Message }) }
    }
    ConvertTo-Json -Depth 4 -Compress -InputObject $out
  `;
  const parsed = asArray(runPowerShell(command)) as { path: string; errors: string[] }[];
  expect(parsed).toHaveLength(4);
  for (const entry of parsed) {
    expect(entry.errors).toEqual([]);
  }
});

// Mocks supply the commands the scripts call, so a deleted-but-mocked function
// stays invisible to the mocked tests. Dot-source the real scripts with no
// mocks and assert the command surface they actually need exists.
test.skipIf(process.platform !== "win32")("dot-sourcing the real scripts defines every command they call", () => {
  const ownership = path.join(process.cwd(), "scripts", "service-ownership.ps1");
  const command = `
    $ErrorActionPreference = 'Stop'
    . '${ownership.replaceAll("'", "''")}'
    . '${serviceStart.replaceAll("'", "''")}'
    . '${supervisor.replaceAll("'", "''")}'
    . '${watchdog.replaceAll("'", "''")}'
    $needed = @('Get-SuperKPortOwner','Test-SuperKServiceProcess','Stop-SuperKServiceProcess',
      'Get-SuperKRunLog','Initialize-SuperKRuntimeEnvironment','Get-SuperKNodePath',
      'Get-SuperKServerJsPath','Get-SuperKUvicornPath','Start-SuperKOcrProcess','Start-SuperKWebProcess',
      'Test-SuperKHealth','Open-SuperKBrowser','Invoke-SuperKWatchdogCycle')
    @{ missing = @($needed | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }) } | ConvertTo-Json -Compress
  `;
  const missing = runPowerShell(command) as { missing: string[] };
  expect(asArray(missing.missing)).toEqual([]);
});
