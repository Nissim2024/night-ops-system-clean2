#!/usr/bin/env bash
# prepare_airgapped.sh <version_tag>
#
# מריץ על המחשב עם אינטרנט — מכין חבילת deploy לשרת ללא אינטרנט
# פלט: nightops-airgapped-<version>.tar.gz
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version_tag>  (e.g. v2.2.0)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${REPO_ROOT}/dist"
PACKAGE_NAME="nightops-airgapped-${VERSION}"
PACKAGE_DIR="${OUTPUT_DIR}/${PACKAGE_NAME}"

GREEN='\033[0;32m'; BLUE_C='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE_C}[•]${NC} $*"; }
header() { echo -e "\n${BOLD}══ $* ══${NC}\n"; }

header "NightOps Air-Gapped Package — ${VERSION}"

# ── 1. קבלת ה-REACT_APP_API_URL ────────────────────────────────────────────
echo ""
echo "מה כתובת השרת שהמשתמשים יגשו אליו? (לדוגמה: https://nightops.company.local)"
read -rp "SERVER_URL: " SERVER_URL
if [ -z "$SERVER_URL" ]; then
  echo "חובה להזין כתובת שרת"
  exit 1
fi
REACT_APP_API_URL="${SERVER_URL}/api"

# ── 2. בניית Docker images ──────────────────────────────────────────────────
header "בניית Docker Images"

info "Backend..."
docker build \
  --tag "nightops-backend:${VERSION}-blue" \
  --tag "nightops-backend:latest-blue" \
  "${REPO_ROOT}/backend"
ok "nightops-backend:${VERSION}-blue"

info "Frontend (API_URL=${REACT_APP_API_URL})..."
docker build \
  --build-arg "REACT_APP_API_URL=${REACT_APP_API_URL}" \
  --build-arg "REACT_APP_ENV=prod" \
  --tag "nightops-frontend:${VERSION}" \
  --tag "nightops-frontend:latest" \
  "${REPO_ROOT}/frontend"
ok "nightops-frontend:${VERSION}"

# ── 3. שמירת images לקובץ ─────────────────────────────────────────────────
header "שמירת Images"
mkdir -p "$OUTPUT_DIR"
IMAGES_TAR="${OUTPUT_DIR}/nightops-images-${VERSION}.tar"

info "שומר images (עשוי לקחת כמה דקות)..."
docker save \
  "nightops-backend:${VERSION}-blue" \
  "nightops-backend:latest-blue" \
  "nightops-frontend:${VERSION}" \
  "nightops-frontend:latest" \
  -o "$IMAGES_TAR"
ok "Images נשמרו: ${IMAGES_TAR}"

# ── 4. הכנת קבצי deploy ────────────────────────────────────────────────────
header "הכנת קבצי Deploy"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

# סקריפטים + config + docker-compose
cp -r "${REPO_ROOT}/deployment" "${PACKAGE_DIR}/deployment"

# images tar
cp "$IMAGES_TAR" "${PACKAGE_DIR}/"

# migrations
mkdir -p "${PACKAGE_DIR}/backend"
cp -r "${REPO_ROOT}/backend/prisma" "${PACKAGE_DIR}/backend/prisma"
cp "${REPO_ROOT}/backend/package.json" "${PACKAGE_DIR}/backend/"

ok "קבצי deploy הוכנו: ${PACKAGE_DIR}"

# ── 5. יצירת .env.example ────────────────────────────────────────────────────
cat > "${PACKAGE_DIR}/deployment/config/.env.example" << 'ENVEOF'
# ============================================================
# NightOps — Production Environment
# העתק ל: /opt/nightops/blue/.env.blue  ו- /opt/nightops/green/.env.green
# ============================================================

SLOT=blue
APP_VERSION=REPLACE_VERSION

# Database (PostgreSQL נטיב על השרת)
DATABASE_URL=postgresql://nightops_user:REPLACE_PASSWORD@localhost:5432/nightops_prod

# JWT
JWT_SECRET=REPLACE_WITH_LONG_RANDOM_STRING_MIN_32_CHARS

# CORS — כתובת הגישה של המשתמשים
CORS_ORIGINS=REPLACE_WITH_SERVER_URL

# Push Notifications (אופציונלי — השאר ריק לביטול)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

# LDAP (אופציונלי)
LDAP_ENABLED=false
LDAP_URL=
LDAP_BASE_DN=
LDAP_BIND_DN=
LDAP_BIND_PASSWORD=
ENVEOF
ok ".env.example נוצר"

# ── 6. יצירת README להתקנה ────────────────────────────────────────────────────
cat > "${PACKAGE_DIR}/INSTALL.md" << READMEEOF
# NightOps ${VERSION} — Air-Gapped Installation

## מה בחבילה
- \`nightops-images-${VERSION}.tar\` — Docker images
- \`deployment/\` — סקריפטים + קונפיגורציות
- \`backend/prisma/\` — DB migrations

## דרישות מוקדמות (IT מתקינים)
- Docker Engine 26.x + Compose plugin
- PostgreSQL 16 (פעיל + DB + user קיימים)
- Redis 7.x (פעיל)
- Nginx 1.24+
- PM2 (אופציונלי)

## שלבי ההתקנה

### שלב 1 — העלה חבילה לשרת
\`\`\`bash
scp -r nightops-airgapped-${VERSION}/ user@SERVER:/opt/nightops/package/
\`\`\`

### שלב 2 — טען Docker images
\`\`\`bash
docker load -i /opt/nightops/package/nightops-images-${VERSION}.tar
\`\`\`

### שלב 3 — הרץ initial deploy
\`\`\`bash
cd /opt/nightops/package/deployment
bash scripts/initial_deploy_airgapped.sh ${VERSION} /opt/nightops/package
\`\`\`

### שלב 4 — מלא .env files כשהסקריפט מבקש
- DATABASE_URL עם סיסמת PostgreSQL
- JWT_SECRET — מחרוזת רנדומלית ארוכה
- CORS_ORIGINS — כתובת השרת (http://IP או https://domain)
READMEEOF
ok "INSTALL.md נוצר"

# ── 7. zip הכל ────────────────────────────────────────────────────────────────
header "יצירת חבילה סופית"
cd "$OUTPUT_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}/"
FINAL_SIZE=$(du -sh "${PACKAGE_NAME}.tar.gz" | cut -f1)
ok "חבילה מוכנה: ${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz (${FINAL_SIZE})"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   החבילה מוכנה להעברה לשרת!                        ${NC}"
echo -e "${BOLD}${GREEN}║                                                      ${NC}"
echo -e "${BOLD}${GREEN}║   קובץ: dist/${PACKAGE_NAME}.tar.gz        ${NC}"
echo -e "${BOLD}${GREEN}║   גודל: ${FINAL_SIZE}                                         ${NC}"
echo -e "${BOLD}${GREEN}║                                                      ${NC}"
echo -e "${BOLD}${GREEN}║   העבר לשרת ועקוב אחר INSTALL.md                   ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
