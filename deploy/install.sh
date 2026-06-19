#!/bin/bash
# ============================================================
# DeployCenter — סקריפט התקנה אוטומטי
#
# אופן שימוש:
#   1. חלץ את ה-ZIP לתיקייה (למשל: /tmp/dc/)
#   2. הרץ מתוך אותה תיקייה:
#      sudo bash deploy/install.sh
# ============================================================
set -e

# תיקיית השורש של ה-ZIP (שם נמצאים backend/ ו-frontend/)
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/var/www/deploycenter"
ENV_FILE="$APP_DIR/backend/.env.prod"

echo ""
echo "======================================"
echo " DeployCenter — התקנה"
echo "======================================"
echo ""

# בדוק Node.js
NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null && node --version || echo "MISSING")
if [[ "$NODE_VER" == "MISSING" ]]; then
  echo "❌ Node.js לא מותקן או גרסה נמוכה מ-18"
  exit 1
fi
echo "✅ Node.js: $NODE_VER"

# בדוק PM2
if ! command -v pm2 &>/dev/null; then
  echo "📦 מתקין PM2..."
  npm install -g pm2
fi
echo "✅ PM2: $(pm2 --version)"

# ======================================
# 1. העתק קוד מקור
# ======================================
echo ""
echo "📂 מעתיק קוד מקור ל-$APP_DIR ..."
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR/backend"  "$APP_DIR/"
cp -r "$SRC_DIR/frontend" "$APP_DIR/"
echo "✅ קוד מקור הועתק"

# ======================================
# 2. קובץ Environment
# ======================================
if [ ! -f "$ENV_FILE" ]; then
  cp "$SRC_DIR/deploy/.env.prod.template" "$ENV_FILE"
  echo ""
  echo "⚠️  יש למלא את קובץ ה-Environment לפני המשך:"
  echo "    nano $ENV_FILE"
  echo ""
  echo "    שנה לפחות:"
  echo "    - DATABASE_URL (שם משתמש, סיסמה, שם DB)"
  echo "    - JWT_SECRET (מחרוזת ארוכה ואקראית)"
  echo "    - CORS_ORIGIN (URL של האתר)"
  echo "    - REACT_APP_API_URL (אותו URL)"
  echo ""
  read -p "אחרי שמילאת את .env.prod, לחץ ENTER להמשך..."
fi
echo "✅ קובץ env קיים"

# ======================================
# 3. PostgreSQL — צור DB
# ======================================
echo ""
echo "🗄️  מגדיר PostgreSQL..."
DB_USER=$(grep DATABASE_URL "$ENV_FILE" | sed 's|.*://\([^:]*\):.*|\1|')
DB_PASS=$(grep DATABASE_URL "$ENV_FILE" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')
DB_NAME=$(grep DATABASE_URL "$ENV_FILE" | sed 's|.*/\([^?]*\).*|\1|')

sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || echo "(משתמש DB כבר קיים)"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || echo "(DB כבר קיים)"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
echo "✅ PostgreSQL מוגדר"

# ======================================
# 4. Backend — התקנה ובנייה
# ======================================
echo ""
echo "🔧 בונה Backend..."
cd "$APP_DIR/backend"
cp "$ENV_FILE" .env.prod
npm ci
npm run build
echo "✅ Backend נבנה"

# ======================================
# 5. Prisma Migrations
# ======================================
echo ""
echo "🗄️  מריץ Database migrations..."
NODE_ENV=prod npx prisma migrate deploy
echo "✅ Migrations הושלמו"

# ======================================
# 6. Frontend — בנייה
# ======================================
echo ""
echo "🎨 בונה Frontend..."
cd "$APP_DIR/frontend"

REACT_URL=$(grep CORS_ORIGIN "$ENV_FILE" | cut -d= -f2)
REACT_APP_API_URL="$REACT_URL" npm ci
REACT_APP_API_URL="$REACT_URL" npm run build
echo "✅ Frontend נבנה"

# ======================================
# 7. הפעל Backend עם PM2
# ======================================
echo ""
echo "🚀 מפעיל Backend..."
cd "$APP_DIR/backend"
pm2 delete deploycenter-api 2>/dev/null || true
NODE_ENV=prod pm2 start dist/main.js --name deploycenter-api
pm2 save
pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true
echo "✅ Backend פועל עם PM2"

# ======================================
# 8. Nginx
# ======================================
echo ""
echo "🌐 מגדיר Nginx..."
cp "$SRC_DIR/deploy/nginx.conf" /etc/nginx/sites-available/deploycenter
ln -sf /etc/nginx/sites-available/deploycenter /etc/nginx/sites-enabled/deploycenter

nginx -t && systemctl reload nginx
echo "✅ Nginx מוגדר"

# ======================================
# סיום
# ======================================
echo ""
echo "======================================"
echo " ✅ DeployCenter הותקן בהצלחה!"
echo "======================================"
echo ""
echo "  📋 בדיקה: curl http://localhost:3000/api/auth/config"
echo "  📋 PM2:   pm2 status"
echo "  📋 Logs:  pm2 logs deploycenter-api"
echo ""
