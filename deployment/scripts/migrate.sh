#!/usr/bin/env bash
# migrate.sh <version_tag>
# מריץ prisma migrate deploy דרך ה-backend container הפעיל
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/nightops.conf"

VERSION="${1:-unknown}"
LOG_FILE="${LOG_DIR}/migrate_${VERSION}_$(date +%Y%m%d_%H%M%S).log"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
info() { echo -e "    $*"; }

mkdir -p "$LOG_DIR"

# ── גלה איזה slot ירוץ עכשיו ─────────────────────────────────────────────────
ACTIVE_SLOT=$(cat "$STATE_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE_SLOT" = "blue" ]; then
  TARGET_CONTAINER="nightops-backend-blue"
else
  TARGET_CONTAINER="nightops-backend-green"
fi

# ── בדוק שה-container קיים ───────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${TARGET_CONTAINER}$"; then
  # Green container עדיין לא active — נסה green
  TARGET_CONTAINER="nightops-backend-green"
  if ! docker ps --format '{{.Names}}' | grep -q "^${TARGET_CONTAINER}$"; then
    err "לא נמצא backend container פעיל (blue/green)"
    exit 1
  fi
fi

info "Running migrations via container: ${TARGET_CONTAINER}"
echo "── Prisma Migrate Deploy (${VERSION}) ──"

# ── First-time baseline detection ─────────────────────────────────────────────
# אם ה-DB כבר קיים מ-db push, צריך baseline את migration הראשוני
MIGRATION_TABLE_EXISTS=$(docker exec "$TARGET_CONTAINER" sh -c \
  "npx prisma migrate status --schema=./prisma/schema.prisma 2>&1 | grep -c 'Database schema is up to date' || true")

if echo "$MIGRATION_TABLE_EXISTS" | grep -q "No migration found"; then
  warn "DB קיים ממצב db push — מבצע baseline של migration ראשוני..."
  docker exec "$TARGET_CONTAINER" \
    npx prisma migrate resolve \
      --applied "0_init" \
      --schema=./prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE"
  ok "Baseline הוחל — migration 0_init מסומן כ-applied"
fi

# ── Run migrate deploy ────────────────────────────────────────────────────────
docker exec "$TARGET_CONTAINER" \
  npx prisma migrate deploy \
    --schema=./prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE"

MIGRATE_EXIT=${PIPESTATUS[0]}

if [ $MIGRATE_EXIT -eq 0 ]; then
  ok "Migrations הוחלו בהצלחה"
  ok "Log: ${LOG_FILE}"
else
  err "Migration נכשל! בדוק את: ${LOG_FILE}"
  err "ל-rollback: bash rollback.sh"
  exit 1
fi
