#!/bin/bash
# ============================================================
# DeployCenter 2.10.11 — סביבת טסט על שרת הייצור
#
#   sudo bash install-test-env.sh              הקמה / שדרוג + עותק טרי של נתוני הייצור
#   sudo bash install-test-env.sh --keep-data  שדרוג גרסה בלבד, הנתונים בטסט נשמרים
#
# מה נוצר (נפרד לגמרי מהייצור, הייצור לא נוגעים בו):
#   תיקייה    /opt/deploycenter-test   (.env + docker-compose.yml משלה)
#   containers dc-test-postgres / dc-test-api / dc-test-frontend
#   נתונים    volume נפרד: deploycenter-test_postgres_data
#   כתובת     http://<השרת>:8080   (HTTPS: certs ב-/opt/deploycenter-test/certs → :8443)
#
# הנתונים: עותק של בסיס הנתונים של הייצור (pg_dump מ-dc-postgres).
# אחרי כל העתקה שליחת מיילים מבוטלת בטסט (EMAIL_ENABLED=false) כדי שתזכורות
# וסיכומים לא יישלחו לאנשים אמיתיים. כתיבה ל-QC נשארת פתוחה — לשימוש מבוקר.
# המיגרציות של הגרסה החדשה רצות על העותק — חזרה גנרלית על נתוני ייצור אמיתיים.
# ============================================================
set -euo pipefail

VERSION="2.10.11"
IMAGES_TAR="deploycenter-docker-v${VERSION}.tar"
COMPOSE_SRC="docker-compose.offline.yml"
PROD_DIR="${DC_PROD_DIR:-/opt/deploycenter}"        # overridable only for a dry run on a dev machine
TEST_DIR="${DC_TEST_DIR:-/opt/deploycenter-test}"
PROJECT="deploycenter-test"
PREFIX="dc-test"
HTTP_PORT=8080
HTTPS_PORT=8443
KEEP_DATA=false
[ "${1:-}" = "--keep-data" ] && KEEP_DATA=true

say()  { echo "  $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} — סביבת טסט (${TEST_DIR}, פורט ${HTTP_PORT})"
echo "======================================================"

# ── בדיקות ───────────────────────────────────────────────
[ "$PROJECT" != "deploycenter" ] || die "שם הפרויקט של הטסט זהה לייצור — עצירה"
command -v docker >/dev/null || die "Docker לא מותקן"
[ -f "$PROD_DIR/.env" ] || die "לא נמצא $PROD_DIR/.env — סביבת הייצור צריכה להיות מותקנת"
[ -f "$COMPOSE_SRC" ] || die "לא נמצא $COMPOSE_SRC בתיקייה הנוכחית"
if [ "$KEEP_DATA" = "false" ]; then
  docker ps --format '{{.Names}}' | grep -x "dc-postgres" >/dev/null || die "dc-postgres (ייצור) לא רץ — אי אפשר להעתיק נתונים"
fi
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${HTTP_PORT}$" >/dev/null && ! docker ps --format '{{.Names}}' | grep -x "${PREFIX}-frontend" >/dev/null; then
  die "פורט ${HTTP_PORT} תפוס על ידי תהליך אחר"
fi

# ── images ───────────────────────────────────────────────
if docker image inspect "deploycenter-api:${VERSION}" >/dev/null 2>&1 && docker image inspect "deploycenter-frontend:${VERSION}" >/dev/null 2>&1; then
  say "images של ${VERSION} כבר טעונים"
else
  [ -f "$IMAGES_TAR" ] || die "לא נמצא $IMAGES_TAR"
  say "טוען images מ-${IMAGES_TAR} ..."
  docker load -i "$IMAGES_TAR"
fi

# ── תיקייה, .env, compose ────────────────────────────────
mkdir -p "$TEST_DIR/certs"
ENV_FILE="$TEST_DIR/.env"
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40; }
setv() { if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi; }
if [ ! -f "$ENV_FILE" ]; then
  say "יוצר .env לטסט על בסיס הייצור (Oracle / QC / LDAP כמו בייצור, סודות חדשים)"
  cp "$PROD_DIR/.env" "$ENV_FILE"
  setv DB_PASSWORD "$(rand)"
  setv JWT_SECRET "$(rand)"
  setv SEED_DATA_FILE ""
  # CORS: the same hosts as production, on the test port
  PROD_CORS=$(grep "^CORS_ORIGINS=" "$PROD_DIR/.env" | cut -d= -f2- | tr -d '"' || true)
  TEST_CORS=""
  IFS=',' read -ra ORIGINS <<< "$PROD_CORS"
  for o in "${ORIGINS[@]}"; do
    o=$(echo "$o" | xargs); o="${o%/}"; [ -z "$o" ] && continue
    host=$(echo "$o" | sed -E 's#^(https?://[^/:]+).*#\1#')
    TEST_CORS="${TEST_CORS:+$TEST_CORS,}${host}:${HTTP_PORT},${host/http:/https:}:${HTTPS_PORT}"
  done
  setv CORS_ORIGINS "${TEST_CORS:-*}"
  echo "" >> "$ENV_FILE"
  echo "# ── סביבת טסט (נוצר ע\"י install-test-env.sh) ──" >> "$ENV_FILE"
  # replace, never append twice — the production .env may already carry DC_* (e.g. HTTPS)
  setv COMPOSE_PROJECT_NAME "${PROJECT}"
  setv DC_PREFIX "${PREFIX}"
  setv DC_ENV test
  setv DC_HTTP_PORT "${HTTP_PORT}"
  setv DC_HTTPS_BIND "127.0.0.1:44398"
  setv DC_PUBLIC_HTTPS_PORT "${HTTPS_PORT}"
  setv DC_CERTS_DIR "${TEST_DIR}/certs"
  chmod 600 "$ENV_FILE"
fi
# HTTPS for test: only when a certificate was placed in certs/
if [ -f "$TEST_DIR/certs/server.crt" ] && [ -f "$TEST_DIR/certs/server.key" ]; then
  sed -i "s|^DC_HTTPS_BIND=.*|DC_HTTPS_BIND=${HTTPS_PORT}|" "$ENV_FILE"
  say "נמצאה תעודה — HTTPS יופעל על פורט ${HTTPS_PORT}"
fi
sed "s|deploycenter-api:[0-9.]*|deploycenter-api:${VERSION}|; s|deploycenter-frontend:[0-9.]*|deploycenter-frontend:${VERSION}|" "$COMPOSE_SRC" > "$TEST_DIR/docker-compose.yml"
cd "$TEST_DIR"

# ── עותק נתונים מהייצור ──────────────────────────────────
if [ "$KEEP_DATA" = "false" ]; then
  DUMP="$TEST_DIR/prod-copy-$(date +%Y%m%d-%H%M).dump"
  say "מעתיק את בסיס הנתונים של הייצור (pg_dump, הייצור ממשיך לעבוד)..."
  docker exec dc-postgres pg_dump -U dcuser -Fc deploycenter > "$DUMP"
  say "✅ $(du -h "$DUMP" | cut -f1) — $DUMP"

  say "מאפס את נתוני הטסט..."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
  docker volume rm "${PROJECT}_postgres_data" >/dev/null 2>&1 || true

  docker compose up -d postgres
  for i in $(seq 1 60); do
    docker exec "${PREFIX}-postgres" pg_isready -U dcuser -d deploycenter >/dev/null 2>&1 && break
    sleep 2
  done
  sleep 3
  say "משחזר את העותק לטסט..."
  docker exec -i "${PREFIX}-postgres" pg_restore -U dcuser -d deploycenter --no-owner --no-privileges < "$DUMP" || \
    say "(pg_restore החזיר אזהרות — ממשיך; בודק נתונים בהמשך)"

  # never mail real people from test
  docker exec "${PREFIX}-postgres" psql -U dcuser -d deploycenter -qc \
    "UPDATE \"SystemParam\" SET value='false' WHERE key='EMAIL_ENABLED';" >/dev/null
  say "✅ שליחת מיילים בוטלה בטסט (EMAIL_ENABLED=false)"
  USERS=$(docker exec "${PREFIX}-postgres" psql -U dcuser -d deploycenter -tAc 'SELECT count(*) FROM "User";')
  VERSIONS=$(docker exec "${PREFIX}-postgres" psql -U dcuser -d deploycenter -tAc 'SELECT count(*) FROM "Version";')
  say "✅ הועתקו: ${USERS} משתמשים, ${VERSIONS} גרסאות"
  ls -1t "$TEST_DIR"/prod-copy-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f   # keep the last 3 copies
fi

# ── הפעלה (ה-API מריץ את המיגרציות של הגרסה החדשה על הנתונים) ──
say "מפעיל את סביבת הטסט..."
docker compose up -d
# wait until the API reports its migrations (success or failure) and answers
MIG=""
for i in $(seq 1 90); do
  LOG=$(docker logs "${PREFIX}-api" 2>&1 || true)
  if grep -q "Migrations OK" <<< "$LOG"; then MIG=ok; fi
  if grep -qiE "migrate.*(error|failed)|P3009|P3018" <<< "$LOG"; then MIG=failed; break; fi
  if [ "$MIG" = "ok" ] && curl -fsS "http://localhost:${HTTP_PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
case "$MIG" in
  ok)     say "✅ מיגרציות הגרסה הוחלו בהצלחה על עותק הייצור" ;;
  failed) say "❌ המיגרציות נכשלו על עותק הייצור — אל תתקין את הגרסה בייצור! פרטים: docker logs ${PREFIX}-api" ;;
  *)      say "⚠️  לא התקבל אישור מיגרציות תוך 3 דקות — בדוק: docker logs ${PREFIX}-api" ;;
esac
docker compose ps

echo ""
echo "======================================================"
echo " סביבת הטסט עלתה: http://$(hostname -f 2>/dev/null || hostname):${HTTP_PORT}"
echo "   התחברות — אותם משתמשים וסיסמאות כמו בייצור (עותק)"
echo "   מיילים: כבויים  |  QC: קריאה וכתיבה פתוחות — עבודה מבוקרת"
echo "   ריענון נתונים מהייצור:   sudo bash install-test-env.sh"
echo "   שדרוג גרסה בלי ריענון:  sudo bash install-test-env.sh --keep-data"
echo "   כיבוי:  cd ${TEST_DIR} && docker compose down"
echo "======================================================"
