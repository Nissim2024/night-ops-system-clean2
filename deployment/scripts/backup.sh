#!/usr/bin/env bash
# backup.sh <version_tag>
# מבצע pg_dump לפני כל deploy
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/nightops.conf"

VERSION="${1:-unknown}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${TIMESTAMP}_${VERSION}.sql.gz"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
info() { echo -e "    $*"; }

# ── Load DB connection from env file ──────────────────────────────────────────
# DATABASE_URL format: postgresql://user:pass@host:port/dbname
ENV_FILE="${DEPLOY_BASE}/.env.prod"
[ -f "$ENV_FILE" ] || ENV_FILE="${DEPLOY_BASE}/config/.env"
[ -f "$ENV_FILE" ] && source <(grep DATABASE_URL "$ENV_FILE" | head -1) || true

if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL לא מוגדר. הגדר ב-${ENV_FILE} או export DATABASE_URL=..."
  exit 1
fi

# Parse DATABASE_URL
DB_USER=$(echo "$DATABASE_URL" | sed -E 's|postgresql://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

echo "── Backup: ${DB_NAME}@${DB_HOST}:${DB_PORT} → ${BACKUP_FILE} ──"

mkdir -p "$BACKUP_DIR"

PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
ok "Backup נשמר: ${BACKUP_FILE} (${SIZE})"

# ── Retention: מחיקת גיבויים ישנים ───────────────────────────────────────────
if [ -d "$BACKUP_DIR" ]; then
  DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | wc -l)
  [ "$DELETED" -gt 0 ] && info "נמחקו ${DELETED} גיבויים ישנים (> ${BACKUP_KEEP_DAYS} ימים)"
fi

# ── Write backup manifest ─────────────────────────────────────────────────────
echo "${TIMESTAMP} ${VERSION} ${BACKUP_FILE} ${SIZE}" >> "${BACKUP_DIR}/manifest.log"

exit 0
