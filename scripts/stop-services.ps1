param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'service-ownership.ps1')
$skipped = 0
$stopped = 0
try {
    $listeners = @(Get-NetTCPConnection -LocalPort 8765,3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($serviceProcessId in $listeners) {
        try {
            $snapshot = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceProcessId" -ErrorAction Stop
            if ($snapshot -and (Stop-SuperKServiceProcess -ProcessInfo $snapshot -ProjectRoot $ProjectRoot)) {
                $stopped++
            } else {
                $skipped++
                Write-Warning "Skipped unverified process $serviceProcessId."
            }
        } catch {
            $skipped++
            Write-Warning "Could not verify or stop process $serviceProcessId."
        }
    }
} catch {
    Write-Warning 'Could not inspect local service listeners.'
    exit 1
}
Write-Output "Stopped $stopped verified SuperK service process(es)."
if ($skipped -gt 0) { exit 1 }
exit 0
