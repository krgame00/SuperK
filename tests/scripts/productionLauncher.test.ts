// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const supervisor = path.join(process.cwd(), "scripts", "start-production.ps1");

test("production entrypoint delegates to a hidden launcher and exits without an interactive menu", () => {
  const batch = fs.readFileSync(path.join(process.cwd(), "start-prod.bat"), "utf8");
  expect(batch).toContain("SuperK-Production.vbs");
  expect(batch).not.toMatch(/choice|cmd \/k|start \/min/i);
  const vbs = fs.readFileSync(path.join(process.cwd(), "SuperK-Production.vbs"), "utf8");
  expect(vbs).toContain("start-production.ps1");
  expect(vbs).toMatch(/\.Run .*?, 0, False/);
});

test.skipIf(process.platform !== "win32")("hidden production supervisor waits for both services, logs output, reuses owned services and rejects failures", () => {
  expect(fs.existsSync(supervisor)).toBe(true);
  const command = `
    $ErrorActionPreference = 'Stop'
    . '${supervisor.replaceAll("'", "''")}'
    $script:events = @(); $script:scenario = 'new'; $script:healthCalls = 0
    function Test-Path { param($LiteralPath, $Path)
      if ($script:scenario -eq 'build-failed' -and $LiteralPath -like '*standalone*server.js') { return $false }
      return $true
    }
    function Get-Command { param($Name) [pscustomobject]@{ Source='C:\\Node\\node.exe' } }
    function New-Item { param($Path, $ItemType, [switch]$Force) }
    function Get-Item { param($LiteralPath, $Path)
      return [pscustomobject]@{ LastWriteTime = [datetime]'2020-01-01T00:00:00' }
    }
    function Get-ChildItem { param($Path, [switch]$Recurse, [switch]$File, $ErrorAction)
      if ($script:scenario -eq 'stale') { return @([pscustomobject]@{ FullName='C:\\SuperK Test\\src\\app\\page.tsx'; LastWriteTime=[datetime]'2021-01-01T00:00:00' }) }
      return @()
    }
    function Get-SuperKPortOwner { param($Port)
      if ($script:scenario -eq 'reuse' -or ($script:scenario -eq 'stale' -and $Port -eq 3000)) {
        return [pscustomobject]@{ ExecutablePath='C:\\Node\\node.exe'; CommandLine='node.exe "C:\\SuperK Test\\.next\\standalone\\server.js"' }
      }
      if ($script:scenario -eq 'foreign') {
        return [pscustomobject]@{ ExecutablePath='C:\\Node\\node.exe'; CommandLine='node.exe C:\\Other\\app.js' }
      }
      return $null
    }
    function Stop-SuperKServiceProcess { param($ProcessInfo, $ProjectRoot)
      $script:events += [pscustomobject]@{ kind='stop'; pid=$ProcessInfo.ProcessId }
      return $true
    }
    function Start-Process {
      param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru, [switch]$Wait)
      $script:events += [pscustomobject]@{ kind='process'; exe=$FilePath; args=$ArgumentList; style=$WindowStyle; stdout=$RedirectStandardOutput; stderr=$RedirectStandardError }
      return [pscustomobject]@{ Id=123; HasExited=($script:scenario -eq 'exited'); ExitCode=$(if ($script:scenario -eq 'build-failed') { 1 } else { 0 }) }
    }
    function Test-SuperKHealth { param($Url)
      $script:events += [pscustomobject]@{ kind='health'; url=$Url }
      $script:healthCalls++
      return $script:healthCalls -gt 2
    }
    function Start-Sleep { param($Milliseconds) }
    function Open-SuperKBrowser { param($Url) $script:events += [pscustomobject]@{ kind='browser'; url=$Url } }
    Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test'
    $fresh = $script:events
    $script:events = @(); $script:scenario = 'reuse'; $script:healthCalls = 2
    Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test'
    $reuse = $script:events
    $script:events = @(); $script:scenario = 'foreign'; $foreignRejected = $false
    try { Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test' } catch { $foreignRejected = $true }
    $foreign = $script:events
    $script:events = @(); $script:scenario = 'exited'; $script:healthCalls = 0; $exitRejected = $false
    try { Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test' } catch { $exitRejected = $true }
    $exited = $script:events
    $script:events = @(); $script:scenario = 'build-failed'; $buildRejected = $false
    try { Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test' } catch { $buildRejected = $true }
    $build = $script:events
    $script:events = @(); $script:scenario = 'stale'; $script:healthCalls = 0
    Start-SuperKProduction -ProjectRoot 'C:\\SuperK Test'
    $stale = $script:events
    [pscustomobject]@{ fresh=$fresh; reuse=$reuse; foreign=$foreign; foreignRejected=$foreignRejected; exitRejected=$exitRejected; exited=$exited; buildRejected=$buildRejected; build=$build; stale=$stale } | ConvertTo-Json -Depth 6 -Compress
  `;
  const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim());
  const processes = result.fresh.filter((event: { kind: string; args: string | string[] }) => event.kind === "process" && !String(event.args).includes("sync-standalone-assets"));
  expect(processes).toHaveLength(2);
  for (const process of processes) {
    expect(process.style).toBe("Hidden");
    expect(process.stdout).toContain(".superk-runtime");
    expect(process.stderr).toContain(".superk-runtime");
    expect(process.stdout).not.toBe(process.stderr);
  }
  expect(processes[0].args).toContain("app.api:app");
  expect(processes[1].args).toContain('"C:\\SuperK Test\\.next\\standalone\\server.js"');
  expect(result.fresh.at(-1)).toMatchObject({ kind: "browser", url: "http://127.0.0.1:3000" });
  expect(result.fresh.filter((event: { kind: string }) => event.kind === "health").length).toBeGreaterThan(2);
  expect(result.reuse.some((event: { kind: string }) => event.kind === "process")).toBe(false);
  expect(result.reuse.at(-1).kind).toBe("browser");
  expect(result.foreignRejected).toBe(true);
  expect(result.foreign).toHaveLength(0);
  expect(result.exitRejected).toBe(true);
  expect(result.exited.some((event: { kind: string }) => event.kind === "browser")).toBe(false);
  expect(result.buildRejected).toBe(true);
  expect(result.build).toHaveLength(1);
  expect(result.build[0].args).toContain("build");
  // Stale source with an owned web: the supervisor stops the running web,
  // rebuilds and brings both services back.
  expect(result.stale.some((event: { kind: string }) => event.kind === "stop")).toBe(true);
  const staleBuild = result.stale.find((event: { kind: string; args: string | string[] }) => event.kind === "process" && String(event.args).includes("build"));
  expect(staleBuild).toBeTruthy();
  const staleStopIndex = result.stale.findIndex((event: { kind: string }) => event.kind === "stop");
  const staleBuildIndex = result.stale.indexOf(staleBuild);
  expect(staleStopIndex).toBeGreaterThanOrEqual(0);
  expect(staleBuildIndex).toBeGreaterThan(staleStopIndex);
  const staleProcesses = result.stale.filter((event: { kind: string; args: string | string[] }) => event.kind === "process" && !String(event.args).includes("sync-standalone-assets"));
  expect(staleProcesses).toHaveLength(3);
  expect(staleProcesses[0].args).toContain("build");
  expect(staleProcesses[1].args).toContain("app.api:app");
  expect(staleProcesses[2].args).toContain("standalone\\server.js");
  expect(result.stale.at(-1)).toMatchObject({ kind: "browser", url: "http://127.0.0.1:3000" });
});

test.skipIf(process.platform !== "win32")("VBScript constructs a quoted hidden supervisor command without launching services", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "SuperK-Production.vbs"), "utf8");
  const probeDirectory = path.join(process.cwd(), ".scratch");
  fs.mkdirSync(probeDirectory, { recursive: true });
  const probe = path.join(probeDirectory, "production-launcher-syntax.vbs");
  fs.writeFileSync(probe, source.replace("shell.Run command, 0, False", "WScript.Echo command"));
  try {
    const output = execFileSync("cscript.exe", ["//Nologo", probe], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    expect(output).toContain('-File "');
    expect(output).toContain('start-production.ps1" -ProjectRoot "');
  } finally {
    fs.unlinkSync(probe);
  }
});
