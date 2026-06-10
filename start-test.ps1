# start-test.ps1
# Starts TEST environment: backend on :3001 (compiled) + frontend on :3002
# DB: nightops_test @ localhost:5433
# Use this ONLY after rollout-to-test.ps1 approved the build.

$Root     = $PSScriptRoot
$Backend  = "$Root\backend"
$Frontend = "$Root\frontend"

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  NightOps  TEST  environment" -ForegroundColor Yellow
Write-Host "  Backend  -> http://localhost:3001" -ForegroundColor Yellow
Write-Host "  Frontend -> http://localhost:3002" -ForegroundColor Yellow
Write-Host "  DB       -> localhost:5433  (nightops_test)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# --- Backend: kill existing on 3001 ---
$existing = netstat -ano | Select-String ":3001\s.*LISTENING" | Select-Object -First 1
if ($existing) {
    $existingPid = [int](($existing.Line.Trim() -split '\s+')[-1])
    Write-Host "Stopping process on :3001 (PID $existingPid)..." -ForegroundColor Yellow
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# --- Backend: start compiled version ---
$backendCmd = @"
`$env:NODE_ENV='test'
`$env:DATABASE_URL='postgresql://nightops_user:nightops_pass@localhost:5433/nightops_test'
`$env:JWT_SECRET='test-secret-change-in-production'
`$env:PORT='3001'
`$env:ORACLE_ENABLED='false'
Write-Host 'NightOps TEST backend starting on :3001...' -ForegroundColor Yellow
node --enable-source-maps '$Backend\dist\src\main'
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal
Write-Host "TEST backend launched  -> http://localhost:3001" -ForegroundColor Green

Start-Sleep -Seconds 2

# --- Frontend: kill existing on 3002 ---
$existingFe = netstat -ano | Select-String ":3002\s.*LISTENING" | Select-Object -First 1
if ($existingFe) {
    $fePid = [int](($existingFe.Line.Trim() -split '\s+')[-1])
    Write-Host "Stopping process on :3002 (PID $fePid)..." -ForegroundColor Yellow
    Stop-Process -Id $fePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

# --- Frontend: start test dev server ---
$frontendCmd = "Set-Location '$Frontend'; npm run start:test"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
Write-Host "TEST frontend launched -> http://localhost:3002" -ForegroundColor Green

Write-Host ""
Write-Host "TEST environment is starting. Ready in ~15 seconds." -ForegroundColor Yellow
