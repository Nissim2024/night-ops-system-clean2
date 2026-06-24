# ============================================================
# DeployCenter — בניית Docker images ושמירה לקובץ
# הרץ מתיקיית השורש של הפרויקט:
#   cd C:\Projects\night-ops-system-clean2
#   .\docker\build-images.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$VERSION = "2.6.1"
$OUTPUT = "deploycenter-docker-v$VERSION.tar"

Write-Host ""
Write-Host "======================================================"
Write-Host " DeployCenter — בניית Docker images v$VERSION"
Write-Host "======================================================"
Write-Host ""

# בדיקה שDockerרץ
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker לא רץ. הפעל את Docker Desktop ונסה שוב." -ForegroundColor Red
    exit 1
}

# בנה Backend
Write-Host "Building backend image..."
docker build -t "deploycenter-api:$VERSION" ./backend
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: backend build" -ForegroundColor Red; exit 1 }
Write-Host "Backend image built." -ForegroundColor Green

# בנה Frontend
Write-Host ""
Write-Host "Building frontend image..."
docker build --build-arg REACT_APP_API_URL=/api -t "deploycenter-frontend:$VERSION" ./frontend
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: frontend build" -ForegroundColor Red; exit 1 }
Write-Host "Frontend image built." -ForegroundColor Green

# הורד PostgreSQL image
Write-Host ""
Write-Host "Pulling postgres:16-alpine..."
docker pull postgres:16-alpine
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: postgres pull" -ForegroundColor Red; exit 1 }
Write-Host "postgres pulled." -ForegroundColor Green

# שמור את כל ה-images לקובץ אחד
Write-Host ""
Write-Host "Saving all images to $OUTPUT ..."
docker save `
    "deploycenter-api:$VERSION" `
    "deploycenter-frontend:$VERSION" `
    "postgres:16-alpine" `
    -o $OUTPUT

if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: docker save" -ForegroundColor Red; exit 1 }

$size = [math]::Round((Get-Item $OUTPUT).Length / 1MB, 0)
Write-Host ""
Write-Host "======================================================"
Write-Host " DONE! קובץ מוכן: $OUTPUT ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host " שלבים הבאים:"
Write-Host " 1. העבר את $OUTPUT לשרת"
Write-Host " 2. העבר את docker\docker-compose.offline.yml לשרת"
Write-Host " 3. העבר את docker\.env.template לשרת (שנה ל-.env ומלא)"
Write-Host " 4. העבר את docker\install-docker.sh לשרת"
Write-Host " 5. הרץ: sudo bash install-docker.sh"
Write-Host "======================================================"
