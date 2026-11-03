function Get-SuperKRunLog {
    param([string]$LogDirectory, [string]$BaseName, [string]$RunStamp)
    # Per-run service logs: a crashed run's stderr must survive the next start
    # instead of being truncated by it. Keep the newest 15 files per stream.
    Get-ChildItem -Path $LogDirectory -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$BaseName-2*.log" } |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    Join-Path $LogDirectory "$BaseName-$RunStamp.log"
}

function Initialize-SuperKRuntimeEnvironment {
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
}

function Get-SuperKNodePath {
    (Get-Command node.exe -ErrorAction Stop).Source
}

function Get-SuperKServerJsPath {
    param([string]$ProjectRoot)
    Join-Path $ProjectRoot '.next\standalone\server.js'
}

function Get-SuperKUvicornPath {
    param([string]$ProjectRoot)
    $cleanerDirectory = Join-Path $ProjectRoot 'ocr-service'
    $uvicornExe = Join-Path $cleanerDirectory '.venv\Scripts\uvicorn.exe'
    if (-not (Test-Path -LiteralPath $uvicornExe)) { throw 'OCR virtual environment is missing.' }
    $uvicornExe
}

function Start-SuperKOcrProcess {
    param([string]$ProjectRoot)
    $logDirectory = Join-Path $ProjectRoot '.superk-runtime'
    New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
    $uvicornExe = Get-SuperKUvicornPath -ProjectRoot $ProjectRoot
    $env:SUPERK_ENABLE_ADAPTIVE_ROI_V2 = '1'
    $env:SUPERK_RESIDUAL_SWEEP = '1'
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath $uvicornExe -ArgumentList @('app.api:app', '--host', '127.0.0.1', '--port', '8765') -WorkingDirectory (Join-Path $ProjectRoot 'ocr-service') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'ocr' -RunStamp $runStamp) -RedirectStandardError (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'ocr-error' -RunStamp $runStamp)
}

function Start-SuperKWebProcess {
    param([string]$ProjectRoot)
    $logDirectory = Join-Path $ProjectRoot '.superk-runtime'
    New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
    $nodeExe = Get-SuperKNodePath
    $serverPath = Get-SuperKServerJsPath -ProjectRoot $ProjectRoot
    $env:SUPERK_ENABLE_ADAPTIVE_ROI_V2 = '1'
    $env:SUPERK_RESIDUAL_SWEEP = '1'
    $env:PORT = '3000'
    $env:HOSTNAME = '127.0.0.1'
    $env:SUPERK_PROJECT_ROOT = $ProjectRoot
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath $nodeExe -ArgumentList "`"$serverPath`"" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'web' -RunStamp $runStamp) -RedirectStandardError (Get-SuperKRunLog -LogDirectory $logDirectory -BaseName 'web-error' -RunStamp $runStamp)
}
