#!/bin/bash
# ============================================================
# DeployCenter — התקנה ללא אינטרנט על RHEL 9
#
# דרישות מוקדמות (כבר מותקנות על השרת):
#   ✅ Node.js 20
#   ✅ PostgreSQL 16 (רץ)
#   ✅ Nginx (רץ)
#
# אופן שימוש:
#   1. העבר את deploycenter-v2.6.0-offline.tar.gz לשרת
#   2. tar -xzf deploycenter-v2.6.0-offline.tar.gz -C /tmp
#   3. sudo bash /tmp/deploycenter-package/deploy/install-offline.sh
# ============================================================

set -e

PACKAGE_DIR="/tmp/deploycenter-package"
APP_DIR="/var/www/deploycenter"
ENV_FILE="$APP_DIR/backend/.env.prod"
SERVICE_NAME="deploycenter-api"

echo ""
echo "======================================================"
echo " DeployCenter — התקנה על RHEL 9 (ללא אינטרנט)"
echo "======================================================"
echo ""

# ── בדוק Node.js ──
if ! command -v node &>/dev/null; then
  echo "❌ Node.js לא מותקן"
  exit 1
fi
echo "✅ Node.js: $(node --version)"

# ── 1. צור תיקיות ──
echo ""
echo "📁 יוצר תיקיות..."
mkdir -p "$APP_DIR/backend"
mkdir -p "$APP_DIR/frontend"

# ── 2. העתק Backend ──
echo "📂 מעתיק Backend..."
cp -r "$PACKAGE_DIR/backend/dist"         "$APP_DIR/backend/"
cp -r "$PACKAGE_DIR/backend/node_modules" "$APP_DIR/backend/"
cp -r "$PACKAGE_DIR/backend/prisma"       "$APP_DIR/backend/"
cp    "$PACKAGE_DIR/backend/package.json" "$APP_DIR/backend/"

# ── 3. העתק Frontend ──
echo "📂 מעתיק Frontend..."
cp -r "$PACKAGE_DIR/frontend/build" "$APP_DIR/frontend/"

# ── 4. קובץ Environment ──
echo ""
if [ ! -f "$ENV_FILE" ]; then
  echo "════════════════════════════════════════════════════"
  echo "  יש ליצור את קובץ ההגדרות לפני שממשיכים"
  echo "════════════════════════════════════════════════════"
  echo ""

  # צור JWT Secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

  # קרא כתובת שרת
  SERVER_URL=""
  if [ -f "$PACKAGE_DIR/SERVER_URL" ]; then
    SERVER_URL=$(cat "$PACKAGE_DIR/SERVER_URL")
  fi

  echo "יוצר קובץ הגדרות ב: $ENV_FILE"
  echo ""
  cat > "$ENV_FILE" << ENVEOF
NODE_ENV=prod
PORT=3000

# ← שנה: STRONG_PASSWORD = הסיסמה שבחרת לבסיס הנתונים
DATABASE_URL=postgresql://dcuser:STRONG_PASSWORD@localhost:5432/deploycenter

# ← אל תשנה — סיסמת אבטחה שנוצרה אוטומטית
JWT_SECRET=$JWT_SECRET

# ← שנה: כתובת האתר שלך
CORS_ORIGINS=${SERVER_URL:-https://deploycenter.YOURCOMPANY.com}
ENVEOF

  echo "📝 קובץ נוצר. פתח ועדכן:"
  echo ""
  echo "   nano $ENV_FILE"
  echo ""
  echo "   שנה: STRONG_PASSWORD ← סיסמת DB שלך"
  if [ -z "$SERVER_URL" ]; then
    echo "   שנה: CORS_ORIGINS ← כתובת האתר שלך"
  fi
  echo ""
  read -p "לאחר שמילאת ושמרת — לחץ ENTER להמשך..."
fi
echo "✅ קובץ env קיים"

# ── 5. בדוק DATABASE_URL ──
DB_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | cut -d= -f2-)
if echo "$DB_URL" | grep -q "STRONG_PASSWORD"; then
  echo ""
  echo "❌ DATABASE_URL עדיין מכיל 'STRONG_PASSWORD' — יש לעדכן את $ENV_FILE"
  exit 1
fi

# ── 6. PostgreSQL — צור DB ──
echo ""
echo "🗄️  מגדיר PostgreSQL..."

# תיקון auth (ident → md5)
PG_HBA="/var/lib/pgsql/data/pg_hba.conf"
if grep -q "\bident\b" "$PG_HBA" 2>/dev/null; then
  sed -i 's/\bident\b/md5/g' "$PG_HBA"
  systemctl restart postgresql
  echo "✅ pg_hba.conf עודכן (ident → md5)"
fi

# חלץ פרטי DB מה-URL
DB_USER=$(echo "$DB_URL" | sed 's|.*://\([^:]*\):.*|\1|')
DB_PASS=$(echo "$DB_URL" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed 's|.*/\([^?]*\).*|\1|')

sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  && echo "✅ משתמש DB נוצר" || echo "  (משתמש כבר קיים)"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null \
  && echo "✅ בסיס נתונים נוצר" || echo "  (DB כבר קיים)"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null

# ── 7. Prisma Migrations (ללא אינטרנט — משתמש ב-binaries המובנות) ──
echo ""
echo "🗄️  מריץ Database migrations..."
cd "$APP_DIR/backend"
export DATABASE_URL="$DB_URL"
"$APP_DIR/backend/node_modules/.bin/prisma" migrate deploy
echo "✅ Migrations הושלמו"

# ── 8. Nginx ──
echo ""
echo "🌐 מגדיר Nginx..."
cp "$PACKAGE_DIR/deploy/nginx.conf" /etc/nginx/conf.d/deploycenter.conf

CORS_URL=$(grep "^CORS_ORIGINS=" "$ENV_FILE" | cut -d= -f2- | cut -d, -f1 | tr -d ' ')
DOMAIN=$(echo "$CORS_URL" | sed 's|https\?://||' | cut -d/ -f1)

if [ -n "$DOMAIN" ]; then
  sed -i "s/deploycenter.yourcompany.com/$DOMAIN/g" /etc/nginx/conf.d/deploycenter.conf
  echo "✅ Nginx domain עודכן ל: $DOMAIN"
fi

echo ""
echo "⚠️  ערוך את קובץ Nginx להוסיף נתיבי SSL:"
echo "   nano /etc/nginx/conf.d/deploycenter.conf"
echo ""
echo "   ssl_certificate     /path/to/your/cert.crt;"
echo "   ssl_certificate_key /path/to/your/key.key;"
echo ""
read -p "לאחר שעדכנת SSL — לחץ ENTER להמשך (או Enter לדלג אם אין SSL עדיין)..."

nginx -t && systemctl reload nginx && echo "✅ Nginx מוגדר"

# ── 9. SELinux ──
echo ""
echo "🔒 מגדיר SELinux..."
setsebool -P httpd_can_network_connect 1
chcon -R -t httpd_sys_content_t "$APP_DIR/frontend/build" 2>/dev/null || true
echo "✅ SELinux מוגדר"

# ── 10. Firewall ──
echo ""
echo "🔥 פותח פורטים בחומת אש..."
firewall-cmd --permanent --add-service=http  2>/dev/null || true
firewall-cmd --permanent --add-service=https 2>/dev/null || true
firewall-cmd --reload 2>/dev/null || true
echo "✅ Firewall מוגדר"

# ── 11. systemd Service ──
echo ""
echo "🚀 מגדיר שירות systemd..."
cp "$PACKAGE_DIR/deploy/deploycenter-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable deploycenter-api
systemctl start  deploycenter-api
sleep 3
systemctl status deploycenter-api --no-pager
echo "✅ שירות הופעל"

# ── 12. בדיקה ──
echo ""
echo "════════════════════════════════════════════════════"
echo " בדיקה..."
echo "════════════════════════════════════════════════════"
sleep 2
if curl -sf http://localhost:3000/auth/config > /dev/null; then
  echo "✅ API עונה!"
else
  echo "⚠️  API לא עונה עדיין — בדוק לוגים:"
  echo "   journalctl -u deploycenter-api -n 30"
fi

echo ""
echo "======================================================"
echo " ✅ DeployCenter הותקן בהצלחה!"
echo ""
echo " בדיקות:"
echo "   systemctl status deploycenter-api"
echo "   journalctl -u deploycenter-api -f"
echo "   curl http://localhost:3000/auth/config"
echo "======================================================"
