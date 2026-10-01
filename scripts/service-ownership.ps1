function Test-SuperKServiceProcess {
    param([object]$ProcessInfo, [string]$ProjectRoot)

    if (-not $ProcessInfo.ExecutablePath -or -not $ProcessInfo.CommandLine) { return $false }
    $rootPath = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\').ToLowerInvariant()
    $executableName = [IO.Path]::GetFileName($ProcessInfo.ExecutablePath).ToLowerInvariant()
    $arguments = @([regex]::Matches($ProcessInfo.CommandLine, '"([^"]*)"|(\S+)') | ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
    })
    if ($arguments.Count -lt 2) { return $false }
    $entrypoint = $arguments[1].Replace('/', '\').ToLowerInvariant()

    if ($executableName -eq 'node.exe') {
        return $entrypoint -in @(
            "$rootPath\node_modules\next\dist\bin\next",
            "$rootPath\node_modules\next\dist\server\lib\start-server.js",
            "$rootPath\.next\standalone\server.js"
        )
    }
    if ($executableName -notin @('python.exe', 'pythonw.exe', 'uvicorn.exe')) { return $false }
    $venvScripts = @("$rootPath\ocr-service\venv\scripts", "$rootPath\ocr-service\.venv\scripts")
    $scopedUvicorn = @($venvScripts | ForEach-Object { "$_\uvicorn.exe" })
    if ($entrypoint -in $scopedUvicorn) {
        return $arguments.Count -ge 3 -and $arguments[2] -eq 'app.api:app'
    }
    $executableDir = [IO.Path]::GetDirectoryName($ProcessInfo.ExecutablePath).ToLowerInvariant()
    if ($executableDir -notin $venvScripts) { return $false }
    if ($executableName -eq 'uvicorn.exe') { return $entrypoint -eq 'app.api:app' }
    return $arguments.Count -ge 4 -and $entrypoint -eq '-m' -and
        $arguments[2] -eq 'uvicorn' -and $arguments[3] -eq 'app.api:app'
}

function Stop-SuperKServiceProcess {
    param([object]$ProcessInfo, [string]$ProjectRoot)

    if (-not (Test-SuperKServiceProcess -ProcessInfo $ProcessInfo -ProjectRoot $ProjectRoot)) { return $false }
    # Re-read immutable launch identity immediately before termination to catch PID reuse.
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($ProcessInfo.ProcessId)" -ErrorAction Stop
    if (-not $current -or $current.CreationDate -ne $ProcessInfo.CreationDate -or
        $current.ExecutablePath -ne $ProcessInfo.ExecutablePath -or
        $current.CommandLine -ne $ProcessInfo.CommandLine) { return $false }
    $processObject = Get-Process -Id $current.ProcessId -ErrorAction Stop
    if (-not $current.CreationDate -or
        [Math]::Abs(($processObject.StartTime.ToUniversalTime() - $current.CreationDate.ToUniversalTime()).TotalSeconds) -gt 1) {
        return $false
    }
    Stop-Process -InputObject $processObject -Force -ErrorAction Stop
    return $true
}
