[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Rclone: Moving F:\Mega to gdrive:XBep/6.69"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Starting Rclone Move: F:\Mega -> gdrive:XBep/6.69" -ForegroundColor Green
Write-Host "  Transfers: 4 | Chunk Size: 128M | Realtime Progress (-P)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

rclone move "F:\Mega" "gdrive:XBep/6.69" `
  --drive-chunk-size 128M `
  --transfers 4 `
  --checkers 8 `
  --fast-list `
  --exclude ".tmp*/**" `
  -P

Write-Host "`nAll files moved successfully!" -ForegroundColor Green
Read-Host "Press Enter to exit"
