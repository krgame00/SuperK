$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot
$pythonExe = if (Test-Path ".\venv\Scripts\python.exe") { ".\venv\Scripts\python.exe" } else { ".\.venv\Scripts\python.exe" }
& $pythonExe -m uvicorn app.api:app --host 127.0.0.1 --port 8765
