// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const ownershipScript = path.join(process.cwd(), "scripts", "service-ownership.ps1");

test("stop script does not terminate listeners based only on a port or window title", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "stop.bat"), "utf8");
  expect(script).not.toMatch(/Stop-Process|taskkill/i);
  expect(script).toContain("stop-services.ps1");
});

test.skipIf(process.platform !== "win32")("ownership proves the service entrypoint and rejects unrelated processes", () => {
  expect(fs.existsSync(ownershipScript)).toBe(true);
  const root = "C:\\SuperK";
  const cases = [
    { ExecutablePath: "C:\\Node\\node.exe", CommandLine: '"C:\\Node\\node.exe" "C:\\SuperK\\node_modules\\next\\dist\\bin\\next" dev', expected: true },
    { ExecutablePath: "C:\\Node\\node.exe", CommandLine: 'node.exe "C:\\Other\\node_modules\\next\\dist\\bin\\next" dev', expected: false },
    { ExecutablePath: "C:\\Node\\node.exe", CommandLine: 'node.exe "C:\\SuperK-Other\\node_modules\\next\\dist\\bin\\next" dev', expected: false },
    { ExecutablePath: "C:\\Node\\node.exe", CommandLine: 'node.exe other.js --note "C:\\SuperK\\node_modules\\next\\dist\\bin\\next"', expected: false },
    { ExecutablePath: "C:\\Python\\python.exe", CommandLine: 'python.exe "C:\\SuperK\\ocr-service\\venv\\Scripts\\uvicorn.exe" app.api:app --port 8765', expected: true },
    { ExecutablePath: "C:\\Python\\python.exe", CommandLine: 'python.exe -m uvicorn app.api:app --port 8765', expected: false },
    { ExecutablePath: "C:\\SuperK\\ocr-service\\venv\\Scripts\\python.exe", CommandLine: 'python.exe -m uvicorn app.api:app --port 8765', expected: true },
    { ExecutablePath: "C:\\SuperK\\ocr-service\\venv\\Scripts\\python.exe", CommandLine: 'python.exe -m uvicorn unrelated.api:app --port 8765', expected: false },
    { ExecutablePath: null, CommandLine: 'node.exe "C:\\SuperK\\node_modules\\next\\dist\\bin\\next" dev', expected: false },
  ];
  const json = JSON.stringify(cases).replaceAll("'", "''");
  const scriptPath = ownershipScript.replaceAll("'", "''");
  const command = `$ErrorActionPreference = 'Stop'; . '${scriptPath}'; $items = '${json}' | ConvertFrom-Json; $results = @($items | ForEach-Object { Test-SuperKServiceProcess -ProcessInfo $_ -ProjectRoot '${root}' }); ConvertTo-Json -Compress -InputObject $results`;
  const results = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim());
  expect(results).toEqual(cases.map(item => item.expected));
});

test.skipIf(process.platform !== "win32")("shutdown checks launch identity and process start time again before stopping", () => {
  const scriptPath = ownershipScript.replaceAll("'", "''");
  const command = `
    $ErrorActionPreference = 'Stop'; . '${scriptPath}'
    $started = [datetime]'2026-10-01T00:00:00Z'
    $snapshot = [pscustomobject]@{ ProcessId=123; ExecutablePath='C:\\Node\\node.exe'; CommandLine='node.exe "C:\\SuperK\\node_modules\\next\\dist\\bin\\next" dev'; CreationDate=$started }
    $script:current = $snapshot; $script:handleStart = $started; $script:stopCount = 0
    function Get-CimInstance { [CmdletBinding()] param($ClassName, $Filter) $script:current }
    function Get-Process { [CmdletBinding()] param($Id) [pscustomobject]@{ StartTime=$script:handleStart } }
    function Stop-Process { [CmdletBinding()] param($InputObject, [switch]$Force) $script:stopCount++ }
    $verified = Stop-SuperKServiceProcess -ProcessInfo $snapshot -ProjectRoot 'C:\\SuperK'
    $script:current = [pscustomobject]@{ ProcessId=123; ExecutablePath=$snapshot.ExecutablePath; CommandLine=$snapshot.CommandLine; CreationDate=$started.AddMinutes(1) }
    $reusedPid = Stop-SuperKServiceProcess -ProcessInfo $snapshot -ProjectRoot 'C:\\SuperK'
    $script:current = $snapshot; $script:handleStart = $started.AddMinutes(1)
    $changedHandle = Stop-SuperKServiceProcess -ProcessInfo $snapshot -ProjectRoot 'C:\\SuperK'
    ConvertTo-Json -Compress -InputObject @($verified, $reusedPid, $changedHandle, $script:stopCount)
  `;
  const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim());
  expect(result).toEqual([true, false, false, 1]);
});
