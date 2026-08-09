$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot
& ".\.venv\Scripts\python.exe" -m uvicorn app.api:app --host 127.0.0.1 --port 8765
