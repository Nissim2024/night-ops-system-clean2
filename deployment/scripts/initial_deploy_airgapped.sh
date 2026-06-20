#!/usr/bin/env bash
# initial_deploy_airgapped.sh <version_tag> <package_dir>
#
# התקנה ראשונית על שרת ללא אינטרנט
# - מדלג על git clone (קוד כבר בחבילה)
# - מדלג על docker build (images כבר טעונים)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/DeployCenter.conf"

VERSION="${1:-}"
PACKAGE_DIR="${2:-}"
if [ -z "$VERSION" ] || [ -z "$PACKAGE_DIR" ]; then
  echo "Usage: $0 <version_tag> <package_dir>"
  echo "       $0 v2.2.0 /opt/DeployCenter/package"
  exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE_C='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
info()   { echo -e "${BLUE_C}[•]${NC} $*"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n"; }

header "DeployCenter Air-Gapped Initial Deploy — ${VERSION}"

# ── 1. יצירת תיקיות ──────────────────────────────────────────────────────────
header "יצירת תשתית"
mkdir -p "${DEPLOY_BASE}"/{state,backups,logs,blue,green,app}
ok "תיקיות: ${DEPLOY_BASE}"

# ── 2. העתקת קוד מהחבילה (במקום git clone) ─────────────────────────────────
header "העתקת קוד"
APP_DIR="${DEPLOY_BASE}/app"
cp -r "${PACKAGE_DIR}/deployment" "${APP_DIR}/deployment"
cp -r "${PACKAGE_DIR}/backend" "${APP_DIR}/backend"
ok "קוד הועתק ל-${APP_DIR}"

# ── 3. env files ─────────────────────────────────────────────────────────────
header "קבצי סביבה"
for SLOT in blue green; do
  ENV_FILE="${DEPLOY_BASE}/${SLOT}/.env.${SLOT}"
  if [ ! -f "$ENV_FILE" ]; then
    info "יוצר תבנית: ${ENV_FILE}"
    cp "${PACKAGE_DIR}/deployment/config/.env.example" "$ENV_FILE"
    sed -i "s/REPLACE_VERSION/${VERSION}/" "$ENV_FILE"
    sed -i "s/^SLOT=.*/SLOT=${SLOT}/" "$ENV_FILE"
    echo ""
    echo -e "${RED}!!! עדכן את ${ENV_FILE} לפני המשך !!!${NC}"
    echo -e "${RED}    (DATABASE_URL, JWT_SECRET, CORS_ORIGINS)${NC}"
    echo ""
  else
    ok "קיים: ${ENV_FILE}"
  fi
done

echo ""
echo -e "${YELLOW}פתח עורך טקסט ועדכן:${NC}"
echo "  ${DEPLOY_BASE}/blue/.env.blue"
echo "  ${DEPLOY_BASE}/green/.env.green"
echo ""
read -rp "האם עדכנת את קובצי ה-.env? (y/N): " CONFIRM
[[ "${CONFIRM,,}" != "y" ]] && { echo "עדכן את קובצי ה-.env ונסה שוב"; exit 1; }

# ── 4. בדיקת PostgreSQL ────────────────────────────────────────────────────
header "בדיקת PostgreSQL"
ENV_BLUE="${DEPLOY_BASE}/blue/.env.blue"
DB_URL=$(grep "^DATABASE_URL=" "$ENV_BLUE" | cut -d= -f2-)
if psql "$DB_URL" -c "SELECT 1" &>/dev/null; then
  ok "PostgreSQL נגיש"
else
  err "לא ניתן להתחבר ל-PostgreSQL — בדוק DATABASE_URL"
  exit 1
fi

# ── 5. בדיקת Redis ─────────────────────────────────────────────────────────
header "בדיקת Redis"
if redis-cli ping | grep -q PONG; then
  ok "Redis פעיל"
else
  err "Redis לא מגיב — בדוק שהשירות פעיל"
  exit 1
fi

# ── 6. Docker network ────────────────────────────────────────────────────────
header "Docker Network"
docker network inspect DeployCenter-net &>/dev/null \
  || docker network create DeployCenter-net
ok "DeployCenter-net"

# ── 7. אימות images קיימים (במקום docker build) ──────────────────────────────
header "אימות Docker Images"
BACKEND_IMAGE="DeployCenter-backend:${VERSION}-blue"
FRONTEND_IMAGE="DeployCenter-frontend:${VERSION}"

if ! docker image inspect "$BACKEND_IMAGE" &>/dev/null; then
  err "Image לא נמצא: ${BACKEND_IMAGE}"
  err "הרץ: docker load -i ${PACKAGE_DIR}/DeployCenter-images-${VERSION}.tar"
  exit 1
fi
ok "$BACKEND_IMAGE"

if ! docker image inspect "$FRONTEND_IMAGE" &>/dev/null; then
  err "Image לא נמצא: ${FRONTEND_IMAGE}"
  err "הרץ: docker load -i ${PACKAGE_DIR}/DeployCenter-images-${VERSION}.tar"
  exit 1
fi
ok "$FRONTEND_IMAGE"

# ── 8. DB Migration ──────────────────────────────────────────────────────────
header "DB Migrations"
info "מריץ Prisma migrations..."
docker run --rm \
  --env-file "$ENV_BLUE" \
  --network host \
  "$BACKEND_IMAGE" \
  sh -c "npx prisma migrate deploy --schema=./prisma/schema.prisma"
ok "Migrations הורצו"

# ── 9. הפעלת Blue Slot ────────────────────────────────────────────────────────
header "הפעלת Blue Slot"
APP_VERSION="$VERSION" \
  docker compose \
    -f "${APP_DIR}/deployment/blue/docker-compose.yml" \
    --env-file "$ENV_BLUE" \
    up -d
ok "Blue containers פעילים"

# ── 10. Health Check ─────────────────────────────────────────────────────────
header "Health Check"
info "ממתין לעלייה (20 שניות)..."
sleep 20
bash "${SCRIPT_DIR}/healthcheck.sh" blue || {
  err "Blue לא בריא — בדוק: docker logs DeployCenter-backend-blue"
  exit 1
}

# ── 11. Nginx ────────────────────────────────────────────────────────────────
header "Nginx Configuration"
cp "${APP_DIR}/deployment/nginx/DeployCenter.conf" "$NGINX_SITE_CONF"
cp "${APP_DIR}/deployment/nginx/upstream-blue.conf" "$NGINX_UPSTREAM_CONF"

if nginx -t; then
  nginx -s reload 2>/dev/null || nginx
  ok "Nginx מוגדר ופעיל"
else
  err "בעיה בקונפיג nginx — בדוק ידנית"
  exit 1
fi

# ── 12. State ────────────────────────────────────────────────────────────────
echo "blue" > "$STATE_FILE"
ok "State → blue"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   DeployCenter ${VERSION} הותקן בהצלחה!              ${NC}"
echo -e "${BOLD}${GREEN}║                                                      ${NC}"
echo -e "${BOLD}${GREEN}║   Slot פעיל: BLUE                                   ${NC}"
echo -e "${BOLD}${GREEN}║   Backend:  127.0.0.1:${BLUE_BACKEND_PORT}                        ${NC}"
echo -e "${BOLD}${GREEN}║   Frontend: 127.0.0.1:${BLUE_FRONTEND_PORT}                        ${NC}"
echo -e "${BOLD}${GREEN}║   Nginx:    port 80 → Blue                          ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
