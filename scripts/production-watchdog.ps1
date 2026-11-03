param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [int]$IntervalSeconds = 10,
    [int]$MaxRestartsPerWindow = 5,
    [int]$WindowMinutes = 10,
    [int]$MaxCycles = 0
)

# Production watchdog: restarts the web/ocr services when their ports go quiet.
# Coordination surface under <ProjectRoot>\.superk-runtime:
#   watchdog.pause        held by start-production.ps1 across stop/build/start
#   watchdog.stop         written by stop-services.ps1 to end supervision
#   watchdog-<stamp>.log  one append-only log per watchdog lifetime

$script:SuperKWatchdogForeignPids = @{}

. (Join-Path $PSScriptRoot 'service-ownership.ps1')
. (Join-Path $PSScriptRoot 'service-start.ps1')

function Write-SuperKWatchdogLog {
    param([string]$ProjectRoot, [string]$Message)
    if (-not $script:SuperKWatchdogStamp) {
        $script:SuperKWatchdogStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    }
    $logDirectory = Join-Path $ProjectRoot '.superk-runtime'
    $logPath = Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'watchdog' -RunStamp $script:SuperKWatchdogStamp
    Add-Content -Path $logPath -Value "$([DateTime]::UtcNow.ToString('o')) $Message"
}

function Invoke-SuperKWatchdogCycle {
    param(
        [string]$ProjectRoot,
        [hashtable]$ServiceState,
        [int]$MaxRestartsPerWindow = 5,
        [int]$WindowMinutes = 10
    )
    $rootPath = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $logDirectory = Join-Path $rootPath '.superk-runtime'
    if (Test-Path -LiteralPath (Join-Path $logDirectory 'watchdog.stop')) {
        Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message 'stand-down'
        return @('stand-down')
    }
    if (Test-Path -LiteralPath (Join-Path $logDirectory 'watchdog.pause')) {
        return @('skip-pause')
    }
    $actions = @()
    foreach ($service in @(
        @{ Name = 'web'; Port = 3000 },
        @{ Name = 'ocr'; Port = 8765 }
    )) {
        $owner = Get-SuperKPortOwner -Port $service.Port
        if (-not $owner) {
            $state = $ServiceState[$service.Name]
            $state.restartTimestamps.Add([DateTime]::UtcNow)
            $windowStart = [DateTime]::UtcNow.AddMinutes(-$WindowMinutes)
            while ($state.restartTimestamps.Count -gt 0 -and $state.restartTimestamps[0] -lt $windowStart) {
                $state.restartTimestamps.RemoveAt(0)
            }
            $action = "restart-$($service.Name)"
            $actions += $action
            Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message "$action (port $($service.Port) free)"
            if ($state.restartTimestamps.Count -ge $MaxRestartsPerWindow) {
                $restartList = (@($state.restartTimestamps) | ForEach-Object { $_.ToString('o') }) -join ', '
                Set-Content -Path (Join-Path $logDirectory 'watchdog-gave-up.txt') -Value @(
                    [DateTime]::UtcNow.ToString('o')
                    "service: $($service.Name)"
                    "restarts: $restartList"
                )
                Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message "give-up: $($service.Name) restarted $($state.restartTimestamps.Count) times within $WindowMinutes minutes"
                $message = "SuperK watchdog stopped supervising: $($service.Name) restarted $($state.restartTimestamps.Count) times in $WindowMinutes minutes and its port is still free.`nServices were left stopped. Logs: $logDirectory"
                $shell = New-Object -ComObject WScript.Shell
                $shell.Popup($message, 0, 'SuperK', 16) | Out-Null
                return ($actions + @('give-up'))
            }
            if ($service.Name -eq 'web') {
                Start-SuperKWebProcess -ProjectRoot $rootPath | Out-Null
            } else {
                Start-SuperKOcrProcess -ProjectRoot $rootPath | Out-Null
            }
            continue
        }
        if (Test-SuperKServiceProcess -ProcessInfo $owner -ProjectRoot $rootPath) { continue }
        # A foreign listener is never killed; log each occurrence once, not once per cycle.
        $ownerKey = "$($service.Name):$($owner.ProcessId)"
        if (-not $script:SuperKWatchdogForeignPids.ContainsKey($ownerKey)) {
            $script:SuperKWatchdogForeignPids[$ownerKey] = $true
            $actions += 'skip-foreign'
            Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message "skip-foreign: port $($service.Port) held by pid $($owner.ProcessId) ($($owner.ExecutablePath))"
        }
    }
    if ($actions.Count -eq 0) { return @('no-op') }
    return $actions
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    $rootPath = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $runtimeDirectory = Join-Path $rootPath '.superk-runtime'
    New-Item -Path $runtimeDirectory -ItemType Directory -Force | Out-Null
    $createdNew = $false
    try {
        # The script-scope variable pins the mutex for the process lifetime; a
        # collected mutex releases its name and admits a second watchdog.
        $script:SuperKWatchdogMutex = New-Object System.Threading.Mutex($true, 'Global\SuperKProductionWatchdog', [ref]$createdNew)
    } catch {
        # Without the single-instance guarantee two watchdogs would fight over restarts.
        exit 0
    }
    if (-not $createdNew) { exit 0 }
    $exitCode = 0
    $script:SuperKWatchdogStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message "watchdog started (pid $PID, interval ${IntervalSeconds}s, window ${WindowMinutes}m)"
    $serviceState = @{
        web = @{ restartTimestamps = [System.Collections.Generic.List[datetime]]::new() }
        ocr = @{ restartTimestamps = [System.Collections.Generic.List[datetime]]::new() }
    }
    $cycles = 0
    while ($true) {
        if ($MaxCycles -gt 0 -and $cycles -ge $MaxCycles) { break }
        if ($cycles -gt 0) { Start-Sleep -Seconds $IntervalSeconds }
        $cycles++
        try {
            $actions = @(Invoke-SuperKWatchdogCycle -ProjectRoot $rootPath -ServiceState $serviceState -MaxRestartsPerWindow $MaxRestartsPerWindow -WindowMinutes $WindowMinutes)
        } catch {
            # A transient Win32 query failure must not kill supervision.
            Write-SuperKWatchdogLog -ProjectRoot $rootPath -Message "cycle error: $($_.Exception.Message)"
            continue
        }
        if ($actions -contains 'stand-down') { break }
        if ($actions -contains 'give-up') { $exitCode = 1; break }
    }
    exit $exitCode
}
