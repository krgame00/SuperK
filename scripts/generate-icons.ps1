Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\public\icon-512.png"
$source = [System.Drawing.Image]::FromFile($srcPath)
$sizes = @(16, 48, 128)
$iconsDir = Join-Path $PSScriptRoot "..\chrome-extension\icons"

if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force
}

foreach ($s in $sizes) {
    $dest = New-Object System.Drawing.Bitmap $s, $s
    $graphics = [System.Drawing.Graphics]::FromImage($dest)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $s, $s)
    $graphics.Dispose()
    
    $outPath = Join-Path $iconsDir "icon$s.png"
    $dest.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $dest.Dispose()
    Write-Host "Generated icon: $outPath ($s x $s)"
}

$source.Dispose()
Write-Host "All icons generated successfully!"
