param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$launcherVbs = Join-Path $rootPath 'SuperK-Launcher.vbs'

if (-not (Test-Path -LiteralPath $launcherVbs)) {
    throw "Launcher not found at: $launcherVbs"
}

$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not (Test-Path -LiteralPath $desktopPath)) {
    $desktopPath = Join-Path $env:USERPROFILE 'Desktop'
}

$shortcutPath = Join-Path $desktopPath 'SuperK Manga Translator.lnk'

# Determine best high-resolution icon
$iconPath = Join-Path $rootPath 'public\app-icon.ico'
if (-not (Test-Path -LiteralPath $iconPath)) {
    $iconPath = Join-Path $rootPath 'public\favicon.ico'
}

# Clean up stale/old desktop shortcuts if present
$staleNames = @('start - Shortcut.lnk', 'SuperK-Launcher - Shortcut.lnk', 'SuperK-Production - Shortcut.lnk')
foreach ($stale in $staleNames) {
    $staleFile = Join-Path $desktopPath $stale
    if (Test-Path -LiteralPath $staleFile) {
        Remove-Item -LiteralPath $staleFile -Force -ErrorAction SilentlyContinue
        Write-Host "[INFO] Removed stale shortcut: $stale" -ForegroundColor DarkGray
    }
}

$wscriptExe = (Get-Command wscript.exe -ErrorAction SilentlyContinue).Source
if (-not $wscriptExe) {
    $wscriptExe = 'C:\Windows\System32\wscript.exe'
}

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptExe
$shortcut.Arguments = "`"$launcherVbs`""
$shortcut.WorkingDirectory = $rootPath
$shortcut.Description = 'SuperK Manga Translator - Production AI Translation Studio'
if (Test-Path -LiteralPath $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Save()

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " [SUCCESS] Created SuperK Desktop Shortcut successfully!" -ForegroundColor Green
Write-Host " Shortcut: $shortcutPath" -ForegroundColor White
Write-Host " Target:   $launcherVbs" -ForegroundColor White
Write-Host " Icon:     $iconPath" -ForegroundColor White
Write-Host " Double-click the SuperK icon on your Desktop to start." -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Cyan
