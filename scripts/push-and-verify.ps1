# SuperK Push & CI Verification Script
param (
    [string]$CommitMessage
)

$ErrorActionPreference = "Stop"
Set-Location "F:\Projects\manga-translator"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " [SuperK] Push & Remote CI Automated Verification" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Staging and commit if message provided
if ($CommitMessage) {
    Write-Host "[1/3] Staging all files and committing..." -ForegroundColor Yellow
    git add -A
    git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Nothing new to commit or commit failed."
    }
}

# 2. Push to remote (triggers .git/hooks/pre-push automatically)
Write-Host "[2/3] Pushing to origin main (Pre-push hook will verify quality gates)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Error "Push failed or was blocked by Pre-Push Quality Gates."
    exit $LASTEXITCODE
}

# 3. Monitor GitHub Actions CI Run
Write-Host "`n[3/3] Monitoring GitHub Actions CI run on origin..." -ForegroundColor Yellow
Start-Sleep -Seconds 4

$runId = (gh run list --limit 1 --json databaseId -q ".[0].databaseId").Trim()
if (-not $runId) {
    Write-Warning "Could not detect recent GitHub Actions run ID."
    exit 0
}

Write-Host "Tracking GitHub Actions Run: $runId ..." -ForegroundColor Cyan
gh run watch $runId

$conclusion = (gh run view $runId --json conclusion -q ".conclusion").Trim()
if ($conclusion -eq "success") {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "  ✅ GitHub Actions CI Passed 100% Green (Run: $runId) " -ForegroundColor Green
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Host "`n========================================================" -ForegroundColor Red
    Write-Host "  ❌ GitHub Actions CI Failed (Conclusion: $conclusion)" -ForegroundColor Red
    Write-Host "========================================================`n" -ForegroundColor Red
    
    Write-Host "Fetching failed job logs from GitHub Actions..." -ForegroundColor Yellow
    gh run view $runId --log-failed
    
    Write-Host "`nChecking Gmail for GitHub failure notification..." -ForegroundColor Yellow
    gmail readonly search "from:github $runId" --max 1
}
