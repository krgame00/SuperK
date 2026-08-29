$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot

if (Test-Path "F:\") {
    $fCache = "F:\manga-cache"
    New-Item -ItemType Directory -Path "$fCache\ocr-jobs", "$fCache\paddle", "$fCache\torch", "$fCache\huggingface", "$fCache\temp" -Force | Out-Null
    $env:SUPERK_CACHE_DIR = "$fCache\ocr-jobs"
    $env:PADDLE_HOME = "$fCache\paddle"
    $env:TORCH_HOME = "$fCache\torch"
    $env:HF_HOME = "$fCache\huggingface"
    $env:TEMP = "$fCache\temp"
}

$pythonExe = if (Test-Path ".\venv\Scripts\python.exe") { ".\venv\Scripts\python.exe" } else { ".\.venv\Scripts\python.exe" }
& $pythonExe -m uvicorn app.api:app --host 127.0.0.1 --port 8765
