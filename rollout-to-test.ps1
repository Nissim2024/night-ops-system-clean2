# rollout-to-test.ps1
# Builds the latest code and deploys it to the TEST environment.
# After this script completes, run start-test.ps1 to start the services.

$Root    = $PSScriptRoot
$Backend = "$Root\backend"

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  NightOps  ROLLOUT -> TEST" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# --- Build backend ---
Write-Host "Building backend..." -ForegroundColor Cyan
Push-Location $Backend
$buildResult = npm run build 2>&1
$buildOk = ($LASTEXITCODE -eq 0)
Pop-Location

if (-not $buildOk) {
    Write-Host "BUILD FAILED. Rollout aborted." -ForegroundColor Red
    $buildResult | Write-Host
    exit 1
}
Write-Host "Build succeeded." -ForegroundColor Green

# --- Run DB migrations on test DB ---
Write-Host "Running Prisma migrations on TEST DB..." -ForegroundColor Cyan
Push-Location $Backend
$env:DATABASE_URL = "postgresql://nightops_user:nightops_pass@localhost:5433/nightops_test"
$migrateResult = npx prisma migrate deploy 2>&1
$migrateOk = ($LASTEXITCODE -eq 0)
Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
Pop-Location

if (-not $migrateOk) {
    Write-Host "Migration failed. Check the output below:" -ForegroundColor Red
    $migrateResult | Write-Host
    exit 1
}
Write-Host "Migrations OK." -ForegroundColor Green

Write-Host ""
Write-Host "Rollout complete. Run .\start-test.ps1 to start the TEST environment." -ForegroundColor Magenta
