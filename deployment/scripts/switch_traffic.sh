#!/usr/bin/env bash
# switch_traffic.sh
#
# שלב C — העברת תעבורה מ-Blue ל-Green
# ✔ health check אחרון לפני switch
# ✔ nginx reload ללא downtime
# ✔ Blue נשאר חי ל-grace period
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/DeployCenter.conf"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
info()   { echo -e "    $*"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n"; }

mkdir -p "$(dirname "$STATE_FILE")" "$LOG_DIR"
LOG_FILE="${LOG_DIR}/switch_$(date +%Y%m%d_%H%M%S).log"

CURRENT=$(cat "$STATE_FILE" 2>/dev/null || echo "blue")
TARGET="green"

header "Traffic Switch: ${CURRENT} → ${TARGET}"

# ── לא מחליפים אם כבר על green ───────────────────────────────────────────────
if [ "$CURRENT" = "green" ]; then
  warn "Traffic כבר מופנה ל-Green. להחזרה: bash rollback.sh"
  exit 0
fi

# ── Health check סופי לפני switch ────────────────────────────────────────────
header "בדיקת בריאות אחרונה"
bash "${SCRIPT_DIR}/healthcheck.sh" green 3 5 || {
  err "Green לא בריא — מבטל switch"
  err "תקן את הבעיה ונסה שוב, או: bash rollback.sh"
  exit 1
}

# ── עדכון nginx upstream ──────────────────────────────────────────────────────
header "עדכון Nginx"
UPSTREAM_SRC="${SCRIPT_DIR}/../nginx/upstream-green.conf"
[ -f "$UPSTREAM_SRC" ] || { err "חסר: $UPSTREAM_SRC"; exit 1; }

cp "$UPSTREAM_SRC" "$NGINX_UPSTREAM_CONF"
info "upstream-green.conf → ${NGINX_UPSTREAM_CONF}"

# nginx reload (graceful — ללא downtime)
if nginx -t &>/dev/null; then
  nginx -s reload
  ok "Nginx reloaded בהצלחה"
else
  # בעיה בקונפיג — חזור
  cp "${SCRIPT_DIR}/../nginx/upstream-blue.conf" "$NGINX_UPSTREAM_CONF"
  nginx -s reload 2>/dev/null || true
  err "nginx config לא תקין — rollback אוטומטי ל-Blue"
  exit 1
fi

# ── עדכון state file ──────────────────────────────────────────────────────────
echo "green" > "$STATE_FILE"
ok "State → green"

# ── אימות switch ─────────────────────────────────────────────────────────────
sleep 2
HTTP_CODE=$(curl -so /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1/health" 2>/dev/null || echo "0")
if [[ "$HTTP_CODE" =~ ^(200|503)$ ]]; then
  ok "Nginx מגיב על port 80 → HTTP $HTTP_CODE"
else
  warn "לא ניתן לאמת nginx על port 80 (HTTP $HTTP_CODE) — בדוק ידנית"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') SWITCH ${CURRENT}→${TARGET}" >> "$LOG_FILE"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✓ Traffic עבר ל-Green                          ${NC}"
echo -e "${BOLD}${GREEN}║  Blue נשאר חי ${GRACE_PERIOD}s לצורך rollback מהיר    ${NC}"
echo -e "${BOLD}${GREEN}║                                                  ${NC}"
echo -e "${BOLD}${GREEN}║  לסגירת Blue:  bash deploy_green.sh --stop-blue ${NC}"
echo -e "${BOLD}${GREEN}║  לrollback:    bash rollback.sh                 ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
