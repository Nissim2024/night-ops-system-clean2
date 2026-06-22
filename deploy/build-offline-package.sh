#!/bin/bash
# ============================================================
# DeployCenter — בניית חבילת התקנה ללא אינטרנט עבור RHEL 9
#
# הרץ מ-WSL2 (Ubuntu) על מחשב הפיתוח:
#
#   wsl bash /mnt/c/Projects/night-ops-system-clean2/deploy/build-offline-package.sh https://deploycenter.YOURCOMPANY.com
#
# הקובץ המוכן ייוצר על שולחן העבודה שלך:
#   C:\Users\<user>\Desktop\deploycenter-v2.6.0-offline.tar.gz
# ============================================================

set -e

SERVER_URL="${1:-}"
if [ -z "$SERVER_URL" ]; then
  echo ""
  echo "שימוש: wsl bash /mnt/c/Projects/night-ops-system-clean2/deploy/build-offline-package.sh https://deploycenter.YOURCOMPANY.com"
  echo ""
  exit 1
fi

WINDOWS_REPO="/mnt/c/Projects/night-ops-system-clean2"
LINUX_BUILD="$HOME/deploycenter-build-tmp"
WINDOWS_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
OUTPUT_WIN="/mnt/c/Users/$WINDOWS_USER/Desktop/deploycenter-v2.6.0-offline.tar.gz"

echo ""
echo "======================================================"
echo " DeployCenter — בנייה לשרת $SERVER_URL"
echo "======================================================"
echo ""

# ── 1. העתק את הקוד לתוך מערכת הקבצים של Linux (מהיר יותר) ──
echo "📁 מעתיק קוד מקור ל-Linux filesystem..."
rm -rf "$LINUX_BUILD"
cp -r "$WINDOWS_REPO" "$LINUX_BUILD"
cd "$LINUX_BUILD"
git checkout prod 2>/dev/null || true
echo "✅ קוד מוכן"

# ── 2. בנה Backend ──
echo ""
echo "🔧 מתקין Backend dependencies (יכול לקחת כמה דקות)..."
cd "$LINUX_BUILD/backend"
npm ci
echo "✅ npm ci הושלם"

echo "🔧 מייצר Prisma client (כולל בינאריות RHEL 9)..."
npx prisma generate
echo "✅ Prisma generate הושלם"

echo "🔧 מקמפל TypeScript..."
npm run build
echo "✅ Backend נבנה"

# ── 3. בנה Frontend ──
echo ""
echo "🎨 מתקין Frontend dependencies..."
cd "$LINUX_BUILD/frontend"
npm ci
echo "✅ npm ci הושלם"

echo "🎨 בונה Frontend עם כתובת: $SERVER_URL ..."
REACT_APP_API_URL=/api npm run build
echo "✅ Frontend נבנה"

# ── 4. ארזת הכל לחבילה ──
echo ""
echo "📦 אורז חבילת התקנה..."
PACKAGE_DIR="$HOME/deploycenter-package"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

# Backend: dist + node_modules + prisma
mkdir -p "$PACKAGE_DIR/backend"
cp -r "$LINUX_BUILD/backend/dist"         "$PACKAGE_DIR/backend/"
cp -r "$LINUX_BUILD/backend/node_modules" "$PACKAGE_DIR/backend/"
cp -r "$LINUX_BUILD/backend/prisma"       "$PACKAGE_DIR/backend/"
cp    "$LINUX_BUILD/backend/package.json" "$PACKAGE_DIR/backend/"

# Frontend: רק build (קבצים סטטיים)
mkdir -p "$PACKAGE_DIR/frontend"
cp -r "$LINUX_BUILD/frontend/build" "$PACKAGE_DIR/frontend/"

# Deploy scripts
cp -r "$LINUX_BUILD/deploy" "$PACKAGE_DIR/"

# קובץ עם כתובת השרת (לשימוש ב-install-offline.sh)
echo "$SERVER_URL" > "$PACKAGE_DIR/SERVER_URL"

echo "✅ חבילה ארוזה"

# ── 5. צור tar.gz ──
echo ""
echo "🗜️  יוצר קובץ tar.gz..."
cd "$HOME"
tar -czf deploycenter-v2.6.0-offline.tar.gz deploycenter-package/

# העבר לשולחן העבודה של Windows
cp "$HOME/deploycenter-v2.6.0-offline.tar.gz" "$OUTPUT_WIN" 2>/dev/null || {
  echo "⚠️  לא הצלחתי להעתיק לשולחן העבודה."
  echo "   הקובץ נמצא ב: $HOME/deploycenter-v2.6.0-offline.tar.gz"
  echo "   הרץ: cp ~/deploycenter-v2.6.0-offline.tar.gz /mnt/c/Users/\$USER/Desktop/"
}

echo ""
echo "======================================================"
echo " ✅ חבילה מוכנה!"
echo ""
echo " קובץ: deploycenter-v2.6.0-offline.tar.gz"
echo " גודל: $(du -sh $HOME/deploycenter-v2.6.0-offline.tar.gz | cut -f1)"
echo ""
echo " העבר את הקובץ לשרת והרץ:"
echo "   sudo bash /tmp/deploycenter-package/deploy/install-offline.sh"
echo "======================================================"
