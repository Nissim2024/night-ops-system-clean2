#!/usr/bin/env bash
# deploy_green.sh <version_tag>
#
# שלב A — Deploy גרסה חדשה ל-Green slot
# ✔ בונה images
# ✔ מעלה Green containers
# ✔ מריץ health checks
# ✔ משאיר Blue פעיל
# ✗ לא מחליף traffic
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/DeployCenter.conf"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version_tag>  (e.g. v2.3.0)"
  exit 1
fi

LOG_FILE="${LOG_DIR}/deploy_${VERSION}_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[✓]${NC} $*" | tee -a "$LOG_FILE"; }
err()    { echo -e "${RED}[✗]${NC} $*" | tee -a "$LOG_FILE"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*" | tee -a "$LOG_FILE"; }
info()   { echo -e "${BLUE}[•]${NC} $*" | tee -a "$LOG_FILE"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n" | tee -a "$LOG_FILE"; }

header "DeployCenter Deploy Green — ${VERSION}"
echo "Log: ${LOG_FILE}"
echo "$(date '+%Y-%m-%d %H:%M:%S') Deploy started: ${VERSION}" >> "$LOG_FILE"

# ── 1. Backup ────────────────────────────────────────────────────────────────
header "שלב 1 — Backup"
bash "${SCRIPT_DIR}/backup.sh" "$VERSION" || {
  err "Backup נכשל — deploy מבוטל"
  exit 1
}

# ── 2. Clone / pull latest code ──────────────────────────────────────────────
header "שלב 2 — קוד גרסה ${VERSION}"
APP_DIR="${DEPLOY_BASE}/app"
if [ -d "${APP_DIR}/.git" ]; then
  info "Pulling latest from Git..."
  git -C "$APP_DIR" fetch --tags
  git -C "$APP_DIR" checkout "$VERSION"
  git -C "$APP_DIR" pull --ff-only origin "$VERSION" 2>/dev/null || true
else
  info "Cloning repo..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$VERSION" "$GIT_REPO" "$APP_DIR"
fi
ok "קוד גרסה ${VERSION} מוכן"

# ── 3. בניית Docker images ───────────────────────────────────────────────────
header "שלב 3 — Docker Build"

# ── קרא את ה-CORS_ORIGINS מ-.env.green לבנייה ────────────────────────────────
ENV_FILE="${DEPLOY_BASE}/green/.env.green"
[ -f "$ENV_FILE" ] || ENV_FILE="${DEPLOY_BASE}/config/.env"
CORS_ORIGINS_VAL=$(grep "^CORS_ORIGINS=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")
PUBLIC_URL=$(echo "$CORS_ORIGINS_VAL" | cut -d, -f1)

info "Building backend image: DeployCenter-backend:${VERSION}-green"
docker build \
  --tag "DeployCenter-backend:${VERSION}-green" \
  --tag "DeployCenter-backend:latest-green" \
  "${APP_DIR}/backend" 2>&1 | tail -5 | tee -a "$LOG_FILE"
ok "Backend image built"

info "Building frontend image: DeployCenter-frontend:${VERSION}"
docker build \
  --build-arg "REACT_APP_API_URL=${PUBLIC_URL:-http://localhost}/api" \
  --build-arg "REACT_APP_ENV=prod" \
  --tag "DeployCenter-frontend:${VERSION}" \
  --tag "DeployCenter-frontend:latest" \
  "${APP_DIR}/frontend" 2>&1 | tail -5 | tee -a "$LOG_FILE"
ok "Frontend image built"

# ── 4. Stop existing green (if any) ──────────────────────────────────────────
header "שלב 4 — ניקוי Green קיים"
docker stop DeployCenter-backend-green  2>/dev/null && ok "Stopped old backend-green"  || true
docker stop DeployCenter-frontend-green 2>/dev/null && ok "Stopped old frontend-green" || true
docker rm   DeployCenter-backend-green  2>/dev/null || true
docker rm   DeployCenter-frontend-green 2>/dev/null || true

# ── 5. הבטח שה-network קיים ──────────────────────────────────────────────────
docker network inspect DeployCenter-net &>/dev/null \
  || docker network create DeployCenter-net

# ── 6. העלה Green ────────────────────────────────────────────────────────────
header "שלב 5 — הפעלת Green Slot"
ENV_GREEN="${DEPLOY_BASE}/green/.env.green"
[ -f "$ENV_GREEN" ] || { err "חסר: ${ENV_GREEN}"; exit 1; }

APP_VERSION="$VERSION" \
  docker compose \
    -f "${APP_DIR}/deployment/green/docker-compose.yml" \
    --env-file "$ENV_GREEN" \
    up -d 2>&1 | tee -a "$LOG_FILE"
ok "Green containers הורמו"

# ── 7. Health Checks ─────────────────────────────────────────────────────────
header "שלב 6 — Health Checks"
info "ממתין להתחממות Green (15 שניות)..."
sleep 15

if bash "${SCRIPT_DIR}/healthcheck.sh" green "$HEALTH_RETRIES" "$HEALTH_INTERVAL"; then
  ok "Green HEALTHY ✓"
else
  err "Green UNHEALTHY — מבטל deploy"

  # ניקוי אוטומטי של Green הכושל
  docker compose \
    -f "${APP_DIR}/deployment/green/docker-compose.yml" \
    --env-file "$ENV_GREEN" \
    down 2>/dev/null || true

  echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED healthcheck" >> "$LOG_FILE"
  exit 1
fi

# ── 8. Run Migrations ────────────────────────────────────────────────────────
header "שלב 7 — DB Migrations"
bash "${SCRIPT_DIR}/migrate.sh" "$VERSION" || {
  err "Migration נכשל — מבטל deploy"
  docker compose \
    -f "${APP_DIR}/deployment/green/docker-compose.yml" \
    --env-file "$ENV_GREEN" \
    down 2>/dev/null || true
  exit 1
}

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  Green slot מוכן — גרסה ${VERSION}               ${NC}"
echo -e "${BOLD}${GREEN}║  Blue עדיין פעיל ומשרת תעבורה                  ${NC}"
echo -e "${BOLD}${GREEN}║                                                  ${NC}"
echo -e "${BOLD}${GREEN}║  כדי לעבור:  bash switch_traffic.sh             ${NC}"
echo -e "${BOLD}${GREEN}║  לביטול:    bash rollback.sh                    ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "$(date '+%Y-%m-%d %H:%M:%S') Deploy GREEN complete: ${VERSION}" >> "$LOG_FILE"
