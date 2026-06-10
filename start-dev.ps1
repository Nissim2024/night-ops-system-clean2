# start-dev.ps1
# Starts DEV environment: backend on :3000 (watch mode) + frontend on :3003
# DB: nightops @ localhost:5432

$Root    = $PSScriptRoot
$Backend = "$Root\backend"
$Frontend = "$Root\frontend"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  NightOps  DEV  environment" -ForegroundColor Cyan
Write-Host "  Backend  -> http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Frontend -> http://localhost:3003" -ForegroundColor Cyan
Write-Host "  DB       -> localhost:5432  (nightops)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Backend: kill any process on 3000 ---
$existing = netstat -ano | Select-String ":3000\s.*LISTENING" | Select-Object -First 1
if ($existing) {
    $existingPid = [int](($existing.Line.Trim() -split '\s+')[-1])
    Write-Host "Stopping process on :3000 (PID $existingPid)..." -ForegroundColor Yellow
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

# --- Backend: start in watch mode (new window) ---
$backendCmd = "Set-Location '$Backend'; `$env:NODE_ENV='dev'; npm run start:dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal
Write-Host "DEV backend launched  -> http://localhost:3000" -ForegroundColor Green

Start-Sleep -Seconds 2

# --- Frontend: kill any process on 3003 ---
$existingFe = netstat -ano | Select-String ":3003\s.*LISTENING" | Select-Object -First 1
if ($existingFe) {
    $fePid = [int](($existingFe.Line.Trim() -split '\s+')[-1])
    Write-Host "Stopping process on :3003 (PID $fePid)..." -ForegroundColor Yellow
    Stop-Process -Id $fePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

# --- Frontend: start dev server (new window) ---
$frontendCmd = "Set-Location '$Frontend'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
Write-Host "DEV frontend launched -> http://localhost:3003" -ForegroundColor Green

Write-Host ""
Write-Host "DEV environment is starting. Ready in ~15 seconds." -ForegroundColor Cyan
