#!/usr/bin/env bash
# initial_deploy.sh <version_tag>
#
# התקנה ראשונית — מריץ פעם אחת בלבד
# יוצר תשתית מלאה ומפעיל Blue slot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/DeployCenter.conf"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version_tag>  (e.g. v2.2.0)"
  exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE_C='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
info()   { echo -e "${BLUE_C}[•]${NC} $*"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n"; }

header "DeployCenter Initial Deploy — ${VERSION}"

# ── 1. יצירת תיקיות ──────────────────────────────────────────────────────────
header "יצירת תשתית"
mkdir -p "${DEPLOY_BASE}"/{state,backups,logs,blue,green,app}
ok "תיקיות נוצרו: ${DEPLOY_BASE}"

# ── 2. env files ─────────────────────────────────────────────────────────────
for SLOT in blue green; do
  ENV_FILE="${DEPLOY_BASE}/${SLOT}/.env.${SLOT}"
  if [ ! -f "$ENV_FILE" ]; then
    info "יוצר תבנית: ${ENV_FILE}"
    cp "${SCRIPT_DIR}/../config/.env.example" "$ENV_FILE"
    sed -i "s/^SLOT=.*/SLOT=${SLOT}/" "$ENV_FILE"
    sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" "$ENV_FILE"
    echo ""
    echo -e "${RED}!!! עדכן את ${ENV_FILE} עם הערכים האמיתיים לפני המשך !!!${NC}"
    echo -e "${RED}    (DATABASE_URL, JWT_SECRET, VAPID_*, CORS_ORIGINS)   ${NC}"
    echo ""
  else
    ok "קיים: ${ENV_FILE}"
  fi
done

read -rp "האם עדכנת את קובצי ה-.env? (y/N): " CONFIRM
[[ "${CONFIRM,,}" != "y" ]] && { echo "עדכן את קובצי ה-.env ונסה שוב"; exit 1; }

# ── 3. Clone repo ────────────────────────────────────────────────────────────
header "Clone גרסה ${VERSION}"
APP_DIR="${DEPLOY_BASE}/app"
if [ -d "${APP_DIR}/.git" ]; then
  git -C "$APP_DIR" fetch --tags
  git -C "$APP_DIR" checkout "$VERSION"
  ok "קוד עודכן ל-${VERSION}"
else
  git clone --branch "$VERSION" --depth 1 "$GIT_REPO" "$APP_DIR"
  ok "קוד הורד: ${APP_DIR}"
fi

# ── 4. Docker network ────────────────────────────────────────────────────────
docker network inspect DeployCenter-net &>/dev/null \
  || docker network create DeployCenter-net
ok "Docker network: DeployCenter-net"

# ── 5. Build images ──────────────────────────────────────────────────────────
header "Docker Build"
ENV_BLUE="${DEPLOY_BASE}/blue/.env.blue"
CORS_ORIGINS_VAL=$(grep "^CORS_ORIGINS=" "$ENV_BLUE" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")
PUBLIC_URL=$(echo "$CORS_ORIGINS_VAL" | cut -d, -f1)

info "Building backend..."
docker build \
  --tag "DeployCenter-backend:${VERSION}-blue" \
  --tag "DeployCenter-backend:latest-blue" \
  "${APP_DIR}/backend"
ok "Backend image: DeployCenter-backend:${VERSION}-blue"

info "Building frontend..."
docker build \
  --build-arg "REACT_APP_API_URL=${PUBLIC_URL:-http://localhost}/api" \
  --build-arg "REACT_APP_ENV=prod" \
  --tag "DeployCenter-frontend:${VERSION}" \
  --tag "DeployCenter-frontend:latest" \
  "${APP_DIR}/frontend"
ok "Frontend image: DeployCenter-frontend:${VERSION}"

# ── 6. Start Blue ─────────────────────────────────────────────────────────────
header "הפעלת Blue Slot"
APP_VERSION="$VERSION" \
  docker compose \
    -f "${APP_DIR}/deployment/blue/docker-compose.yml" \
    --env-file "$ENV_BLUE" \
    up -d
ok "Blue containers פעילים"

# ── 7. Health check ──────────────────────────────────────────────────────────
header "Health Check"
info "ממתין לעלייה (20 שניות)..."
sleep 20
bash "${SCRIPT_DIR}/healthcheck.sh" blue || {
  err "Blue לא בריא — בדוק logs: docker logs DeployCenter-backend-blue"
  exit 1
}

# ── 8. DB Migration (Initial) ────────────────────────────────────────────────
header "DB Migration"
info "אם הDB קיים מ-db push, baseline יוחל אוטומטית"
bash "${SCRIPT_DIR}/migrate.sh" "$VERSION"

# ── 9. nginx config ──────────────────────────────────────────────────────────
header "Nginx Configuration"
info "מעתיק קבצי nginx..."
cp "${SCRIPT_DIR}/../nginx/DeployCenter.conf" "$NGINX_SITE_CONF"
cp "${SCRIPT_DIR}/../nginx/upstream-blue.conf" "$NGINX_UPSTREAM_CONF"

if nginx -t; then
  nginx -s reload || nginx
  ok "Nginx מוגדר ופעיל → Blue"
else
  err "בעיה בקונפיג nginx — בדוק ידנית"
  exit 1
fi

# ── 10. State ────────────────────────────────────────────────────────────────
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
echo -e "${BOLD}${GREEN}║                                                      ${NC}"
echo -e "${BOLD}${GREEN}║   לשדרוג גרסה:  bash deploy_green.sh <version>     ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
