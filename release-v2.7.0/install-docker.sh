#!/bin/bash
# ============================================================
# DeployCenter — התקנה מ-Docker images (ללא אינטרנט)
# RHEL 9 + Docker מותקן ורץ
#
# שלבים לפני הרצה:
#   1. העבר לשרת: deploycenter-docker-v2.7.0.tar
#   2. העבר לשרת: docker-compose.offline.yml
#   3. צור .env (ממלא .env.template)
#   4. הרץ: sudo bash install-docker.sh
# ============================================================

set -e

VERSION="2.7.0"
IMAGES_TAR="deploycenter-docker-v${VERSION}.tar"
COMPOSE_FILE="docker-compose.offline.yml"
APP_DIR="/opt/deploycenter"

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} — Docker Installation (Offline)"
echo "======================================================"
echo ""

# ── בדיקות ──────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker לא מותקן" >&2; exit 1
fi
echo "Docker: $(docker --version)"

if [ ! -f "$IMAGES_TAR" ]; then
  echo "ERROR: לא נמצא $IMAGES_TAR בתיקייה הנוכחית" >&2; exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: לא נמצא $COMPOSE_FILE בתיקייה הנוכחית" >&2; exit 1
fi

if [ ! -f ".env" ]; then
  if [ -f ".env.template" ]; then
    cp .env.template .env
    echo ""
    echo "⚠️  מלא את קובץ .env לפני שממשיכים:"
    echo "   nano .env"
    echo ""
    echo "   שנה:"
    echo "   DB_PASSWORD   ← סיסמה חזקה לבסיס הנתונים"
    echo "   JWT_SECRET    ← מחרוזת ארוכה ואקראית"
    echo "   CORS_ORIGINS  ← כתובת ה-IP או הדומיין של השרת"
    echo ""
    read -p "לאחר שמילאת ולחצת Ctrl+X+Y — לחץ ENTER להמשך..."
  else
    echo "ERROR: לא נמצא קובץ .env" >&2; exit 1
  fi
fi

# בדוק שהמשתמש מילא את הערכים
if grep -q "REPLACE_WITH" .env; then
  echo ""
  echo "ERROR: יש ערכים שלא עודכנו ב-.env (REPLACE_WITH...)"
  echo "       ערוך: nano .env"
  exit 1
fi
echo ".env תקין"

# ── טען images ──────────────────────────────────────────
echo ""
echo "טוען Docker images (יכול לקחת כמה דקות)..."
docker load -i "$IMAGES_TAR"
echo "images נטענו בהצלחה"

docker images | grep -E "deploycenter|postgres"

# ── הכן תיקיית אפליקציה ──────────────────────────────
echo ""
echo "מכין תיקיות..."
mkdir -p "$APP_DIR"
cp "$COMPOSE_FILE" "$APP_DIR/docker-compose.yml"
cp ".env"          "$APP_DIR/.env"
echo "קבצים הועתקו ל-$APP_DIR"

# ── עצור native services שעלולים להתנגש ─────────────
echo ""
echo "עוצר שירותים native שעלולים להתנגש..."
systemctl stop postgresql 2>/dev/null && systemctl disable postgresql 2>/dev/null \
  && echo "PostgreSQL native עצר" || echo "(PostgreSQL native לא רץ — בסדר)"
systemctl stop nginx 2>/dev/null \
  && echo "Nginx native עצר" || echo "(Nginx native לא רץ — בסדר)"

# ── Firewall ─────────────────────────────────────────
echo ""
echo "פותח פורטים ב-Firewall..."
firewall-cmd --permanent --add-service=http  2>/dev/null || true
firewall-cmd --reload 2>/dev/null || true
echo "Firewall מוגדר (פורט 80 פתוח)"

# ── SELinux ──────────────────────────────────────────
echo ""
echo "מגדיר SELinux..."
setsebool -P container_manage_cgroup 1 2>/dev/null || true
echo "SELinux מוגדר"

# ── Prisma DB migrations ──────────────────────────────
echo ""
echo "מריץ Prisma migrations..."
docker run --rm \
  --network dc-net \
  -e DATABASE_URL="postgresql://dcuser:${DB_PASSWORD}@dc-postgres:5432/deploycenter" \
  deploycenter-api:${VERSION} \
  npx prisma migrate deploy 2>/dev/null || echo "(migrations — ירוצו בהפעלה ראשונה)"

# ── הפעל Docker Compose ──────────────────────────────
echo ""
echo "מפעיל Docker containers..."
cd "$APP_DIR"
docker compose up -d

# ── בדיקה ────────────────────────────────────────────
echo ""
echo "ממתין לאתחול (30 שניות)..."
sleep 30

docker compose ps

echo ""
if curl -sf http://localhost/api/auth/config > /dev/null 2>&1; then
  echo "API עונה — המערכת עלתה!"
else
  echo "המערכת עדיין מאתחלת — בדוק לוגים:"
  echo "  docker logs dc-api --tail 30"
fi

# ── הפעל אוטומטי בריסטרט ─────────────────────────
echo ""
echo "מגדיר הפעלה אוטומטית בריסטרט שרת..."
cat > /etc/systemd/system/deploycenter-docker.service << 'UNIT'
[Unit]
Description=DeployCenter Docker Stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/deploycenter
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable deploycenter-docker
echo "שירות systemd נרשם"

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} הותקן בהצלחה!"
echo ""
echo " גש לכתובת: http://$(hostname -I | awk '{print $1}')"
echo ""
echo " פקודות שימושיות:"
echo "   docker compose -f $APP_DIR/docker-compose.yml ps"
echo "   docker logs dc-api -f"
echo "   docker logs dc-frontend -f"
echo "   docker logs dc-postgres -f"
echo "======================================================"
