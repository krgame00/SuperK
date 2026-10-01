param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

. (Join-Path $PSScriptRoot 'service-ownership.ps1')

function Get-SuperKPortOwner {
    param([int]$Port)
    $ids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ids.Count -gt 1) { throw "Multiple listeners occupy port $Port." }
    if ($ids.Count -eq 1) {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $($ids[0])" -ErrorAction Stop
    }
    return $null
}

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
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $serverPath = Join-Path $rootPath '.next\standalone\server.js'
    $cleanerDirectory = Join-Path $rootPath 'ocr-service'
    $uvicornExe = Join-Path $cleanerDirectory 'venv\Scripts\uvicorn.exe'
    if (-not (Test-Path -LiteralPath $uvicornExe)) {
        $uvicornExe = Join-Path $cleanerDirectory '.venv\Scripts\uvicorn.exe'
    }
    if (-not (Test-Path -LiteralPath $uvicornExe)) { throw 'OCR virtual environment is missing.' }

    # Verify both occupied ports before starting or rebuilding anything.
    $webOwner = Get-SuperKPortOwner -Port 3000
    $ocrOwner = Get-SuperKPortOwner -Port 8765
    foreach ($owner in @($webOwner, $ocrOwner)) {
        if ($owner -and -not (Test-SuperKServiceProcess -ProcessInfo $owner -ProjectRoot $rootPath)) {
            throw 'Port 3000 or 8765 belongs to another application. It was left running.'
        }
    }

    if (Test-Path -LiteralPath 'F:\') {
        $cacheDirectory = 'F:\manga-cache'
        foreach ($name in @('ocr-jobs', 'paddle', 'torch', 'huggingface', 'temp')) {
            New-Item -Path (Join-Path $cacheDirectory $name) -ItemType Directory -Force | Out-Null
        }
        $env:SUPERK_CACHE_DIR = Join-Path $cacheDirectory 'ocr-jobs'
        $env:PADDLE_HOME = Join-Path $cacheDirectory 'paddle'
        $env:TORCH_HOME = Join-Path $cacheDirectory 'torch'
        $env:HF_HOME = Join-Path $cacheDirectory 'huggingface'
        $env:TEMP = Join-Path $cacheDirectory 'temp'
    }

    if (-not $webOwner) {
        if (-not (Test-Path -LiteralPath $serverPath)) {
            $nextCli = Join-Path $rootPath 'node_modules\next\dist\bin\next'
            $build = Start-Process -FilePath $nodeExe -ArgumentList @("`"$nextCli`"", 'build') -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'build.log') -RedirectStandardError (Join-Path $logDirectory 'build-error.log')
            if ($build.ExitCode -ne 0) { throw 'Production build failed. See build-error.log.' }
        }
        $syncPath = Join-Path $rootPath 'scripts\sync-standalone-assets.mjs'
        $sync = Start-Process -FilePath $nodeExe -ArgumentList "`"$syncPath`"" -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'assets.log') -RedirectStandardError (Join-Path $logDirectory 'assets-error.log')
        if ($sync.ExitCode -ne 0) { throw 'Standalone asset setup failed. See assets-error.log.' }
    }

    $ocrProcess = $null
    $webProcess = $null
    if (-not $ocrOwner) {
        $ocrProcess = Start-Process -FilePath $uvicornExe -ArgumentList @('app.api:app', '--host', '127.0.0.1', '--port', '8765') -WorkingDirectory $cleanerDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'ocr.log') -RedirectStandardError (Join-Path $logDirectory 'ocr-error.log')
    }
    if (-not $webOwner) {
        $env:PORT = '3000'
        $env:HOSTNAME = '127.0.0.1'
        $env:SUPERK_PROJECT_ROOT = $rootPath
        $webProcess = Start-Process -FilePath $nodeExe -ArgumentList "`"$serverPath`"" -WorkingDirectory $rootPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'web.log') -RedirectStandardError (Join-Path $logDirectory 'web-error.log')
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        if (($ocrProcess -and $ocrProcess.HasExited) -or ($webProcess -and $webProcess.HasExited)) {
            throw 'A SuperK service exited during startup. See the service error logs.'
        }
        $webReady = Test-SuperKHealth -Url 'http://127.0.0.1:3000'
        $ocrReady = Test-SuperKHealth -Url 'http://127.0.0.1:8765/health'
        if ($webReady -and $ocrReady) {
            Open-SuperKBrowser -Url 'http://127.0.0.1:3000'
            return
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'SuperK did not become ready within 90 seconds. See the service error logs.'
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
