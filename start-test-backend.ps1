# start-test-backend.ps1
# מפעיל את בקאנד הטסט על פורט 3001 עם DB נפרד (nightops_test / 5433)

$BackendDir = "$PSScriptRoot\backend"

# --- עצור תהליך קיים על 3001 ---
$existing = netstat -ano | Select-String ":3001\s.*LISTENING" | Select-Object -First 1
if ($existing) {
    $existingPid = [int](($existing.Line.Trim() -split '\s+')[-1])
    Write-Host "Stopping existing process on port 3001 (PID $existingPid)..."
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# --- Build ---
Write-Host "Building backend..."
Push-Location $BackendDir
$buildResult = npm run build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED:" -ForegroundColor Red
    $buildResult | Write-Host
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "Build OK." -ForegroundColor Green

# --- הפעלה בחלון נפרד ---
$envBlock = @"
`$env:DATABASE_URL='postgresql://nightops_user:nightops_pass@localhost:5433/nightops_test'
`$env:NODE_ENV='test'
`$env:JWT_SECRET='test-secret-change-in-production'
`$env:PORT='3001'
`$env:VAPID_PUBLIC_KEY='BCUkQXw69yrbptDrkuy-LzhSPyJBYOizTpwFUouydLvJz-M5Sk3avsRHpZK0JjLmLYqQ8WcVScnJIFjMfxgup_0'
`$env:VAPID_PRIVATE_KEY='UX1A2Xxg6CQJIyvxuWY9bUTQ9CXc328lYd1BzZo-nkE'
`$env:ORACLE_ENABLED='false'
Write-Host 'NightOps TEST backend starting on port 3001...' -ForegroundColor Yellow
node --enable-source-maps '$BackendDir\dist\src\main'
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $envBlock -WindowStyle Normal
Write-Host "Test backend launched -> http://localhost:3001" -ForegroundColor Cyan
