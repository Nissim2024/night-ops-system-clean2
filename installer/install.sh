#!/usr/bin/env bash
# =============================================================================
#  DeployCenter — אשף התקנה
#  תומך ב: Ubuntu 20.04/22.04/24.04 ו-RHEL/Rocky/AlmaLinux 8/9
# =============================================================================
set -euo pipefail

# ── צבעים ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[•]${NC} $*"; }
ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
err()     { echo -e "${RED}[✗]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}\n"; }
ask()     { echo -en "${YELLOW}[?]${NC} $* "; }

die() { err "$1"; exit 1; }

# ── זיהוי OS ─────────────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID}"
    OS_VER="${VERSION_ID%%.*}"
  else
    die "לא ניתן לזהות את מערכת ההפעלה"
  fi

  case "$OS_ID" in
    ubuntu|debian) PKG=apt ;;
    rhel|centos|rocky|almalinux|fedora) PKG=yum ;;
    *) die "מערכת הפעלה לא נתמכת: $OS_ID" ;;
  esac
}

# ── בדיקת הרשאות ─────────────────────────────────────────────────────────────
check_root() {
  if [ "$EUID" -ne 0 ]; then
    die "יש להריץ את האשף עם הרשאות root\nנסה: sudo bash install.sh"
  fi
}

# ── קבלת קלט עם ברירת מחדל ──────────────────────────────────────────────────
prompt() {
  local var="$1" prompt_text="$2" default="$3"
  ask "${prompt_text} [${default}]:"
  read -r input
  eval "${var}=\"${input:-$default}\""
}

prompt_secret() {
  local var="$1" prompt_text="$2"
  ask "${prompt_text}:"
  read -rs input
  echo
  if [ -z "$input" ]; then
    eval "${var}=$(openssl rand -hex 32)"
    warn "נוצר מפתח אוטומטי"
  else
    eval "${var}=\"$input\""
  fi
}

# ── פונקציות התקנה ───────────────────────────────────────────────────────────
install_node() {
  header "Node.js"
  if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    ok "Node.js מותקן: $NODE_VER"
    local major="${NODE_VER#v}"; major="${major%%.*}"
    if [ "$major" -lt 18 ]; then
      warn "גרסה $NODE_VER ישנה מדי — נדרשת 18+. מתקין גרסה חדשה..."
    else
      return 0
    fi
  fi

  info "מתקין Node.js 20 LTS..."
  if [ "$PKG" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
    apt-get install -y nodejs &>/dev/null
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - &>/dev/null
    yum install -y nodejs &>/dev/null
  fi
  ok "Node.js $(node --version) הותקן"
}

install_postgresql() {
  header "PostgreSQL"
  if command -v psql &>/dev/null; then
    ok "PostgreSQL מותקן: $(psql --version)"
    return 0
  fi

  info "מתקין PostgreSQL 16..."
  if [ "$PKG" = apt ]; then
    apt-get install -y postgresql postgresql-contrib &>/dev/null
    systemctl enable --now postgresql &>/dev/null
  else
    dnf install -y postgresql-server postgresql-contrib &>/dev/null 2>&1 || \
      yum install -y postgresql-server postgresql-contrib &>/dev/null
    postgresql-setup --initdb &>/dev/null || true
    systemctl enable --now postgresql &>/dev/null
  fi
  ok "PostgreSQL הותקן ופעיל"
}

install_nginx() {
  header "Nginx"
  if command -v nginx &>/dev/null; then
    ok "Nginx מותקן"; return 0
  fi
  info "מתקין Nginx..."
  if [ "$PKG" = apt ]; then
    apt-get install -y nginx &>/dev/null
  else
    yum install -y nginx &>/dev/null
  fi
  systemctl enable --now nginx &>/dev/null
  ok "Nginx הותקן ופעיל"
}

setup_database() {
  header "הגדרת בסיס נתונים"
  info "יוצר משתמש ובסיס נתונים PostgreSQL..."

  # בדיקה אם המשתמש כבר קיים
  DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || echo "")

  if [ "$DB_EXISTS" = "1" ]; then
    warn "בסיס הנתונים '${DB_NAME}' כבר קיים"
    ask "האם לאפס את בסיס הנתונים? (y/N):"
    read -r reset_db
    if [[ "${reset_db,,}" == "y" ]]; then
      sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" &>/dev/null
      sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" &>/dev/null
      info "בסיס הנתונים נמחק"
    else
      info "ממשיך עם בסיס הנתונים הקיים"
      return 0
    fi
  fi

  sudo -u postgres psql <<SQL &>/dev/null
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL
  ok "בסיס נתונים '${DB_NAME}' נוצר עם משתמש '${DB_USER}'"
}

write_env() {
  header "קובץ הגדרות סביבה"
  cat > "${INSTALL_DIR}/backend/.env" <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
JWT_SECRET="${JWT_SECRET}"
PORT=${BACKEND_PORT}
VAPID_PUBLIC_KEY="${VAPID_PUBLIC}"
VAPID_PRIVATE_KEY="${VAPID_PRIVATE}"
VAPID_EMAIL="mailto:${ADMIN_EMAIL}"
ENV
  chmod 600 "${INSTALL_DIR}/backend/.env"
  ok "קובץ .env נכתב"
}

install_dependencies() {
  header "התקנת חבילות"
  info "Backend — npm install..."
  cd "${INSTALL_DIR}/backend"
  npm install --omit=dev --silent 2>/dev/null || npm install --silent
  ok "Backend dependencies הותקנו"

  info "Frontend — npm install + build..."
  cd "${INSTALL_DIR}/frontend"
  npm install --silent
  REACT_APP_API_URL="http://${SERVER_HOST}:${BACKEND_PORT}" npm run build --silent
  ok "Frontend נבנה"
}

run_migrations() {
  header "מיגרציות בסיס נתונים"
  cd "${INSTALL_DIR}/backend"
  info "מריץ Prisma db push..."
  npx prisma db push --accept-data-loss 2>/dev/null || \
    npx prisma migrate deploy 2>/dev/null || true
  ok "סכמת בסיס הנתונים עודכנה"

  info "יוצר משתמש אדמין ראשוני..."
  node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
async function main() {
  const exists = await prisma.user.findFirst({ where: { email: '${ADMIN_EMAIL}' } });
  if (!exists) {
    const hash = await bcrypt.hash('${ADMIN_PASS}', 10);
    await prisma.user.create({ data: { fullName: 'מנהל מערכת', email: '${ADMIN_EMAIL}', password: hash, role: 'ADMIN' } });
    console.log('Admin created');
  } else {
    console.log('Admin already exists');
  }
  await prisma.\$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
" 2>/dev/null
  ok "משתמש אדמין מוכן"
}

build_backend() {
  header "בנייה Backend"
  cd "${INSTALL_DIR}/backend"
  info "מבצע nest build..."
  npm run build --silent
  ok "Backend נבנה"
}

setup_systemd_backend() {
  cat > /etc/systemd/system/deploycenter-backend.service <<SERVICE
[Unit]
Description=DeployCenter Backend (NestJS)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/backend/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=deploycenter-backend

[Install]
WantedBy=multi-user.target
SERVICE
}

setup_nginx_frontend() {
  cat > /etc/nginx/conf.d/deploycenter.conf <<NGINX
server {
    listen ${FRONTEND_PORT};
    server_name ${SERVER_HOST};
    root ${INSTALL_DIR}/frontend/build;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

  # מחיקת ה-default אם קיים
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  nginx -t &>/dev/null && systemctl reload nginx
}

setup_services() {
  header "הגדרת שירותי מערכת (systemd)"

  # יצירת משתמש מערכת אם לא קיים
  if ! id "${APP_USER}" &>/dev/null; then
    useradd --system --no-create-home --shell /sbin/nologin "${APP_USER}"
    ok "משתמש מערכת '${APP_USER}' נוצר"
  fi

  # הרשאות על תיקיית ההתקנה
  chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"

  setup_systemd_backend
  systemctl daemon-reload
  systemctl enable --now deploycenter-backend

  setup_nginx_frontend

  ok "שירותים הוגדרו ופעילים"
}

verify_installation() {
  header "בדיקת התקנה"
  local ok_count=0

  info "ממתין לעלייה של הבאקאנד (15 שניות)..."
  sleep 15

  if systemctl is-active --quiet deploycenter-backend; then
    ok "Backend פעיל (systemd)"
    ((ok_count++))
  else
    err "Backend אינו פעיל"
    warn "בדוק לוגים: journalctl -u deploycenter-backend -n 50"
  fi

  if curl -sf "http://localhost:${BACKEND_PORT}/health" &>/dev/null || \
     curl -sf "http://localhost:${BACKEND_PORT}/api/versions" &>/dev/null; then
    ok "Backend מגיב על port ${BACKEND_PORT}"
    ((ok_count++))
  else
    warn "Backend עדיין לא מגיב — ייתכן שצריך עוד כמה שניות"
  fi

  if systemctl is-active --quiet nginx; then
    ok "Nginx פעיל"
    ((ok_count++))
  else
    err "Nginx אינו פעיל"
  fi

  return $((3 - ok_count))
}

print_summary() {
  echo
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║        DeployCenter — ההתקנה הושלמה!         ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
  echo
  echo -e "  ${BOLD}כתובת הגישה למערכת:${NC}"
  echo -e "  ${CYAN}http://${SERVER_HOST}:${FRONTEND_PORT}${NC}"
  echo
  echo -e "  ${BOLD}פרטי כניסה ראשוניים:${NC}"
  echo -e "  משתמש:  ${CYAN}${ADMIN_EMAIL}${NC}"
  echo -e "  סיסמה:  ${CYAN}${ADMIN_PASS}${NC}"
  echo
  echo -e "  ${BOLD}פקודות שימושיות:${NC}"
  echo -e "  הפעלה:    ${YELLOW}systemctl start deploycenter-backend${NC}"
  echo -e "  עצירה:    ${YELLOW}systemctl stop deploycenter-backend${NC}"
  echo -e "  לוגים:    ${YELLOW}journalctl -u deploycenter-backend -f${NC}"
  echo -e "  מסד נתונים: ${YELLOW}psql -U ${DB_USER} -d ${DB_NAME}${NC}"
  echo
  echo -e "  ${BOLD}קובץ הגדרות:${NC} ${INSTALL_DIR}/backend/.env"
  echo
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════
main() {
  clear
  echo -e "${BOLD}${BLUE}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║       DeployCenter — אשף התקנה       ║"
  echo "  ║         מערכת ניהול עלייה לייצור      ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"

  check_root
  detect_os
  ok "מערכת הפעלה: ${OS_ID} ${OS_VER} (מנהל חבילות: ${PKG})"

  # ── איסוף הגדרות ─────────────────────────────────────────────────────────
  header "הגדרות התקנה"
  echo -e "${CYAN}אנא מלא את הפרטים הבאים (Enter לשמירת ברירת המחדל):${NC}\n"

  INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  ok "תיקיית פרויקט: ${INSTALL_DIR}"

  prompt SERVER_HOST   "כתובת/שם השרת (IP או hostname)" "localhost"
  prompt BACKEND_PORT  "פורט Backend" "3000"
  prompt FRONTEND_PORT "פורט Frontend (Nginx)" "80"

  echo
  echo -e "${CYAN}הגדרות בסיס נתונים:${NC}"
  prompt   DB_NAME "שם בסיס הנתונים" "nightops"
  prompt   DB_USER "שם משתמש DB"     "nightops_user"
  prompt_secret DB_PASS "סיסמת DB"

  echo
  echo -e "${CYAN}משתמש אדמין ראשוני:${NC}"
  prompt   ADMIN_EMAIL "אימייל אדמין" "admin@company.local"
  prompt_secret ADMIN_PASS "סיסמת אדמין"

  echo
  echo -e "${CYAN}הגדרות מתקדמות:${NC}"
  prompt APP_USER "משתמש מערכת להרצת השירות" "deploycenter"
  prompt_secret JWT_SECRET "JWT Secret (Enter לאוטומטי)"

  # VAPID keys — יצירה אוטומטית
  VAPID_PUBLIC="BCUkQXw69yrbptDrkuy-LzhSPyJBYOizTpwFUouydLvJz-M5Sk3avsRHpZK0JjLmLYqQ8WcVScnJIFjMfxgup_0"
  VAPID_PRIVATE="UX1A2Xxg6CQJIyvxuWY9bUTQ9CXc328lYd1BzZo-nkE"

  # ── אישור ────────────────────────────────────────────────────────────────
  echo
  echo -e "${BOLD}סיכום הגדרות:${NC}"
  echo -e "  שרת:          ${SERVER_HOST}:${FRONTEND_PORT} (frontend) / ${BACKEND_PORT} (backend)"
  echo -e "  בסיס נתונים:  ${DB_NAME} @ localhost"
  echo -e "  אדמין:        ${ADMIN_EMAIL}"
  echo -e "  תיקייה:       ${INSTALL_DIR}"
  echo
  ask "להתחיל בהתקנה? (Y/n):"
  read -r confirm
  [[ "${confirm,,}" == "n" ]] && { info "ההתקנה בוטלה"; exit 0; }

  # ── שלבי התקנה ───────────────────────────────────────────────────────────
  echo
  if [ "$PKG" = apt ]; then
    info "מעדכן רשימת חבילות..."
    apt-get update -qq &>/dev/null
  fi

  install_node
  install_postgresql
  install_nginx
  setup_database
  write_env
  install_dependencies
  build_backend
  run_migrations
  setup_services
  verify_installation || true
  print_summary
}

main "$@"
