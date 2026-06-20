#!/usr/bin/env bash
# rollback.sh [reason]
#
# Rollback מיידי — חזרה ל-Blue תוך שניות
# ✔ nginx switch ל-Blue
# ✔ עצירת Green
# ✔ לא נוגע ב-DB
# ✔ לא דורש rebuild
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/DeployCenter.conf"

REASON="${1:-ידני}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n"; }

mkdir -p "$(dirname "$STATE_FILE")" "$LOG_DIR"
LOG_FILE="${LOG_DIR}/rollback_$(date +%Y%m%d_%H%M%S).log"
START_TIME=$(date +%s)

CURRENT=$(cat "$STATE_FILE" 2>/dev/null || echo "blue")

header "ROLLBACK — ${CURRENT} → blue"
warn "סיבה: ${REASON}"
echo "$(date '+%Y-%m-%d %H:%M:%S') ROLLBACK initiated. Reason: ${REASON}" >> "$LOG_FILE"

# ── כבר על blue? ─────────────────────────────────────────────────────────────
if [ "$CURRENT" = "blue" ]; then
  warn "Traffic כבר על Blue — בודק שBlue בריא..."
  bash "${SCRIPT_DIR}/healthcheck.sh" blue 3 3 || {
    err "Blue לא בריא! בדוק את containers ידנית"
    exit 1
  }
  ok "Blue בריא, אין צורך ב-rollback"
  exit 0
fi

# ── ודא ש-Blue containers פעילים ─────────────────────────────────────────────
header "בדיקת Blue"
BLUE_BACKEND_RUNNING=$(docker ps --format '{{.Names}}' | grep -c "^DeployCenter-backend-blue$" || true)
BLUE_FRONTEND_RUNNING=$(docker ps --format '{{.Names}}' | grep -c "^DeployCenter-frontend-blue$" || true)

if [ "$BLUE_BACKEND_RUNNING" -eq 0 ] || [ "$BLUE_FRONTEND_RUNNING" -eq 0 ]; then
  warn "Blue containers לא פעילים — מנסה להפעיל מחדש..."
  APP_DIR="${DEPLOY_BASE}/app"
  ENV_BLUE="${DEPLOY_BASE}/blue/.env.blue"

  docker compose \
    -f "${APP_DIR}/deployment/blue/docker-compose.yml" \
    --env-file "$ENV_BLUE" \
    up -d 2>&1 | tee -a "$LOG_FILE"

  sleep 10
  bash "${SCRIPT_DIR}/healthcheck.sh" blue 6 5 || {
    err "לא ניתן להפעיל Blue — מצב קריטי! התקשר לאחראי"
    exit 1
  }
fi

# ── החלף nginx ל-Blue ─────────────────────────────────────────────────────────
header "החלפת Nginx → Blue"
UPSTREAM_SRC="${SCRIPT_DIR}/../nginx/upstream-blue.conf"
cp "$UPSTREAM_SRC" "$NGINX_UPSTREAM_CONF"

if nginx -t &>/dev/null; then
  nginx -s reload
  ok "Nginx ← Blue (:${BLUE_BACKEND_PORT}/:${BLUE_FRONTEND_PORT})"
else
  err "nginx config לא תקין — בדוק ידנית!"
  exit 1
fi

# ── עדכן state ────────────────────────────────────────────────────────────────
echo "blue" > "$STATE_FILE"
ok "State → blue"

# ── עצור Green ───────────────────────────────────────────────────────────────
header "עצירת Green"
docker stop DeployCenter-backend-green  2>/dev/null && ok "Stopped backend-green"  || warn "backend-green לא רץ"
docker stop DeployCenter-frontend-green 2>/dev/null && ok "Stopped frontend-green" || warn "frontend-green לא רץ"
docker rm   DeployCenter-backend-green  2>/dev/null || true
docker rm   DeployCenter-frontend-green 2>/dev/null || true

# ── מדידת זמן rollback ───────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "$(date '+%Y-%m-%d %H:%M:%S') ROLLBACK complete in ${ELAPSED}s. Reason: ${REASON}" >> "$LOG_FILE"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✓ Rollback הושלם בהצלחה                       ${NC}"
printf  "${BOLD}${GREEN}║  ⏱  זמן rollback: %-3s שניות                    ${NC}\n" "$ELAPSED"
echo -e "${BOLD}${GREEN}║  Traffic חזר ל-Blue                             ${NC}"
echo -e "${BOLD}${GREEN}║  DB לא שונה                                     ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$ELAPSED" -gt 60 ]; then
  warn "Rollback לקח > 60 שניות — בדוק למה Blue לא היה מוכן"
fi
