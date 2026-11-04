param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

. (Join-Path $PSScriptRoot 'service-ownership.ps1')
. (Join-Path $PSScriptRoot 'service-start.ps1')

function Test-SuperKHealth {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch { return $false }
}

function Open-SuperKBrowser {
    param([string]$Url)
    Start-Process -FilePath $Url | Out-Null
}

function Start-SuperKProduction {
    param([string]$ProjectRoot)
    $ErrorActionPreference = 'Stop'
    $rootPath = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $logDirectory = Join-Path $rootPath '.superk-runtime'
    New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    # A fresh run re-arms supervision: clear any stop request left by stop-services.ps1.
    Remove-Item -LiteralPath (Join-Path $logDirectory 'watchdog.stop') -Force -ErrorAction SilentlyContinue
    $nodeExe = Get-SuperKNodePath
    $serverPath = Get-SuperKServerJsPath -ProjectRoot $rootPath
    # Fail fast on a missing OCR venv before any port checks, matching the old resolution order.
    Get-SuperKUvicornPath -ProjectRoot $rootPath | Out-Null

    # Verify both occupied ports before starting or rebuilding anything.
    $webOwner = Get-SuperKPortOwner -Port 3000
    $ocrOwner = Get-SuperKPortOwner -Port 8765
    # Only auto-open the browser on a genuine cold launch; re-invocations while
    # the app is already running (restarts, rebuilds) would just pile up tabs.
    $webWasRunning = [bool]$webOwner
    foreach ($owner in @($webOwner, $ocrOwner)) {
        if ($owner -and -not (Test-SuperKServiceProcess -ProcessInfo $owner -ProjectRoot $rootPath)) {
            throw 'Port 3000 or 8765 belongs to another application. It was left running.'
        }
    }

    Initialize-SuperKRuntimeEnvironment

    $needsBuild = -not (Test-Path -LiteralPath $serverPath)
    if (-not $needsBuild) {
        $serverTime = (Get-Item -LiteralPath $serverPath).LastWriteTime
        $sourceDirs = @(
            (Join-Path $rootPath 'src'),
            (Join-Path $rootPath 'components'),
            (Join-Path $rootPath 'hooks'),
            (Join-Path $rootPath 'lib'),
            (Join-Path $rootPath 'public')
        )
        $latestSource = Get-ChildItem -Path $sourceDirs -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(\.next|node_modules|\.git)\\' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        $configFiles = @(
            (Join-Path $rootPath 'next.config.ts'),
            (Join-Path $rootPath 'package.json')
        )
        foreach ($cfg in $configFiles) {
            if (Test-Path -LiteralPath $cfg) {
                $cfgItem = Get-Item -LiteralPath $cfg
                if ($cfgItem.LastWriteTime -gt $serverTime) {
                    $needsBuild = $true
                    break
                }
            }
        }
        if ($latestSource -and $latestSource.LastWriteTime -gt $serverTime) {
            $needsBuild = $true
        }
    }

    # Hold the watchdog back until stop/build/start has fully settled (success or throw).
    $pausePath = Join-Path $logDirectory 'watchdog.pause'
    New-Item -Path $pausePath -ItemType File -Force | Out-Null
    try {
        if ($needsBuild -and $webOwner) {
            Stop-SuperKServiceProcess -ProcessInfo $webOwner -ProjectRoot $rootPath | Out-Null
            $webOwner = $null
        }

        if (-not $webOwner) {
            if ($needsBuild) {
                $nextCli = Join-Path $rootPath 'node_modules\next\dist\bin\next'
                $build = Start-Process -FilePath $nodeExe -ArgumentList @("`"$nextCli`"", 'build') -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'build' -RunStamp $runStamp) -RedirectStandardError (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'build-error' -RunStamp $runStamp)
                if ($build.ExitCode -ne 0) { throw 'Production build failed. See build-error.log.' }
            }
            $syncPath = Join-Path $rootPath 'scripts\sync-standalone-assets.mjs'
            $sync = Start-Process -FilePath $nodeExe -ArgumentList "`"$syncPath`"" -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'assets' -RunStamp $runStamp) -RedirectStandardError (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'assets-error' -RunStamp $runStamp)
            if ($sync.ExitCode -ne 0) { throw 'Standalone asset setup failed. See assets-error.log.' }
        }

        $ocrProcess = $null
        $webProcess = $null
        if (-not $ocrOwner) {
            $ocrProcess = Start-SuperKOcrProcess -ProjectRoot $rootPath
        }
        if (-not $webOwner) {
            $webProcess = Start-SuperKWebProcess -ProjectRoot $rootPath
        }

        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if (($ocrProcess -and $ocrProcess.HasExited) -or ($webProcess -and $webProcess.HasExited)) {
                throw 'A SuperK service exited during startup. See the service error logs.'
            }
            $webReady = Test-SuperKHealth -Url 'http://127.0.0.1:3000'
            $ocrReady = Test-SuperKHealth -Url 'http://127.0.0.1:8765/health'
            if ($webReady -and $ocrReady) {
                if (-not $webWasRunning) {
                    Open-SuperKBrowser -Url 'http://127.0.0.1:3000'
                }
                return
            }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'SuperK did not become ready within 90 seconds. See the service error logs.'
    } finally {
        Remove-Item -LiteralPath $pausePath -Force -ErrorAction SilentlyContinue
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Start-SuperKProduction -ProjectRoot $ProjectRoot
    } catch {
        $message = "Could not start SuperK: $($_.Exception.Message)`nLogs: $(Join-Path $ProjectRoot '.superk-runtime')"
        $shell = New-Object -ComObject WScript.Shell
        $shell.Popup($message, 0, 'SuperK', 16) | Out-Null
        exit 1
    }
}
