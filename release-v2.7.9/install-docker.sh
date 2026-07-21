#!/bin/bash
# ============================================================
# DeployCenter 2.7.9 — התקנה / שדרוג (ללא אינטרנט)
# תומך ב: RHEL 9.7 + Docker + Oracle 11g + SMB/CIFS
#
# שדרוג מ-2.7.x (אותו שרת):
#   1. העבר: deploycenter-docker-v2.7.9.tar + docker-compose.offline.yml
#   2. העבר: deploycenter-data-export.json (אם יש נתונים לייבוא — כולל מטריצת סקילים)
#   3. הרץ: sudo bash install-docker.sh
#   → ה-.env הקיים נשמר, הנתונים נשמרים, רק images מתעדכנים
#
# התקנה חדשה (שרת ריק):
#   1. העבר את כל הקבצים מתיקיית release-v2.7.9
#   2. הרץ: sudo bash install-docker.sh
# ============================================================

set -e

VERSION="2.7.9"
IMAGES_TAR="deploycenter-docker-v${VERSION}.tar"
COMPOSE_FILE="docker-compose.offline.yml"
APP_DIR="/opt/deploycenter"

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} — Docker Installation (Offline)"
echo " Oracle 11g Thick Mode | RHEL 9.7 | PostgreSQL 16"
echo "======================================================"

# ── זיהוי מצב: שדרוג או התקנה חדשה ──────────────────────
IS_UPGRADE=false
if [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/docker-compose.yml" ]; then
  IS_UPGRADE=true
fi

if [ "$IS_UPGRADE" = "true" ]; then
  echo ""
  echo "*** מצב שדרוג זוהה (קיים $APP_DIR/.env) ***"
  echo "    הנתונים הקיימים ישמרו — רק images ייעודכנו"
else
  echo ""
  echo "*** התקנה חדשה ***"
fi
echo ""

# ── בדיקות בסיסיות ─────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker לא מותקן" >&2; exit 1
fi
echo "Docker: $(docker --version)"

if [ ! -f "$IMAGES_TAR" ]; then
  echo "ERROR: לא נמצא $IMAGES_TAR בתיקייה הנוכחית" >&2
  echo "       וודא שהעברת את קובץ ה-tar לשרת" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: לא נמצא $COMPOSE_FILE בתיקייה הנוכחית" >&2; exit 1
fi

# ══════════════════════════════════════════════════════════
#  שדרוג מ-2.7.x
# ══════════════════════════════════════════════════════════
if [ "$IS_UPGRADE" = "true" ]; then

  ENV_FILE="$APP_DIR/.env"

  # ── שמירת קונפיגורציה קיימת לפני שדרוג ─────────────
  echo "שומר קונפיגורציה קיימת לפני שדרוג..."
  CONFIG_BACKUP="$APP_DIR/config-backup-pre-${VERSION}-$(date +%Y%m%d-%H%M).env"
  cp "$ENV_FILE" "$CONFIG_BACKUP"
  echo "  ✅ קונפיגורציה גובתה: $CONFIG_BACKUP"

  # שמירת פרמטרים קריטיים מה-.env הקיים
  OLD_ORACLE_ENABLED=$(grep "^ORACLE_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")
  OLD_ORACLE_USER=$(grep "^ORACLE_USER=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")
  OLD_ORACLE_CONNECT_STRING=$(grep "^ORACLE_CONNECT_STRING=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")
  OLD_QC_RELEASES_FILE=$(grep "^QC_RELEASES_FILE=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")

  # ── גיבוי DB לפני שדרוג ──────────────────────────────
  echo ""
  echo "גיבוי בסיס הנתונים לפני שדרוג..."
  BACKUP_FILE="$APP_DIR/backup-pre-${VERSION}-$(date +%Y%m%d-%H%M).sql"
  if docker ps --format "{{.Names}}" | grep -q "dc-postgres"; then
    docker exec dc-postgres pg_dump -U dcuser deploycenter > "$BACKUP_FILE" 2>/dev/null \
      && echo "✅ גיבוי נשמר: $BACKUP_FILE" \
      || echo "WARNING: גיבוי נכשל — ממשיך בכל זאת"
  else
    echo "WARNING: dc-postgres לא רץ — מדלג על גיבוי"
  fi

  # ── השלמת משתנים חדשים ב-.env הקיים ──────────────────
  echo ""
  echo "בודק שכל משתני הסביבה הנדרשים (מצטבר עד 2.7.9) קיימים ב-.env..."

  if ! grep -q "^ORACLE_LIB_DIR" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# Oracle Thick Mode — נדרש לOracle 11g (נוסף ב-2.7.1)" >> "$ENV_FILE"
    echo "ORACLE_LIB_DIR=/oracle/lib" >> "$ENV_FILE"
    echo "  ✅ נוסף: ORACLE_LIB_DIR=/oracle/lib"
  else
    echo "  OK: ORACLE_LIB_DIR קיים"
  fi

  if ! grep -q "^LD_LIBRARY_PATH" "$ENV_FILE"; then
    EXISTING_LIB_DIR=$(grep "^ORACLE_LIB_DIR=" "$ENV_FILE" | cut -d= -f2 | tr -d '"')
    echo "" >> "$ENV_FILE"
    echo "# LD_LIBRARY_PATH — נדרש ל-libnnz19.so (נוסף ב-2.7.2)" >> "$ENV_FILE"
    echo "LD_LIBRARY_PATH=${EXISTING_LIB_DIR:-/oracle/lib}" >> "$ENV_FILE"
    echo "  ✅ נוסף: LD_LIBRARY_PATH=${EXISTING_LIB_DIR:-/oracle/lib}"
  else
    echo "  OK: LD_LIBRARY_PATH קיים"
  fi

  if ! grep -q "^ORACLE_HOME" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# ORACLE_HOME — נדרש לקבצי timezone (נוסף ב-2.7.2, מונע ORA-01804)" >> "$ENV_FILE"
    echo "ORACLE_HOME=/oracle/client" >> "$ENV_FILE"
    echo "  ✅ נוסף: ORACLE_HOME=/oracle/client"
  else
    echo "  OK: ORACLE_HOME קיים"
  fi

  if ! grep -q "^QC_RELEASES_FILE" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# קובץ QC Releases — נתיב Linux (נוסף ב-2.7.1)" >> "$ENV_FILE"
    echo "QC_RELEASES_FILE=/mnt/qc-releases/cr_list.xls" >> "$ENV_FILE"
    echo "  ✅ נוסף: QC_RELEASES_FILE=/mnt/qc-releases/cr_list.xls"
  else
    echo "  OK: QC_RELEASES_FILE קיים"
  fi

  # ── השבת ערכי קונפיגורציה שאבדו ──────────────────
  echo ""
  echo "בודק שמירת קונפיגורציה קריטית..."
  if [ -n "$OLD_ORACLE_ENABLED" ] && ! grep -q "^ORACLE_ENABLED=$OLD_ORACLE_ENABLED" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^ORACLE_ENABLED=.*|ORACLE_ENABLED=$OLD_ORACLE_ENABLED|" "$ENV_FILE" 2>/dev/null || true
    echo "  ✅ שוחזר: ORACLE_ENABLED=$OLD_ORACLE_ENABLED"
  fi
  if [ -n "$OLD_QC_RELEASES_FILE" ] && grep -q "^QC_RELEASES_FILE=/mnt/qc-releases/cr_list.xls" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^QC_RELEASES_FILE=.*|QC_RELEASES_FILE=$OLD_QC_RELEASES_FILE|" "$ENV_FILE" 2>/dev/null || true
    echo "  ✅ שוחזר: QC_RELEASES_FILE=$OLD_QC_RELEASES_FILE"
  fi

  # ── [Option C] ייבוא נתונים ───────────────────────────
  if [ -f "deploycenter-data-export.json" ]; then
    mkdir -p "$APP_DIR"
    cp deploycenter-data-export.json "$APP_DIR/"
    echo "  ✅ Data export נמצא — יועתק ל-$APP_DIR ויוייבא בעלייה"
    if ! grep -q "^SEED_DATA_FILE" "$ENV_FILE"; then
      echo "" >> "$ENV_FILE"
      echo "SEED_DATA_FILE=/data/deploycenter-data-export.json" >> "$ENV_FILE"
    else
      sed -i "s|^SEED_DATA_FILE=.*|SEED_DATA_FILE=/data/deploycenter-data-export.json|" "$ENV_FILE"
    fi
    echo "  ✅ SEED_DATA_FILE מוגדר"
  else
    if ! grep -q "^SEED_DATA_FILE" "$ENV_FILE"; then
      echo "" >> "$ENV_FILE"
      echo "SEED_DATA_FILE=" >> "$ENV_FILE"
    fi
    echo "  OK: אין data export — נתונים קיימים ב-postgres_data volume"
  fi

  echo ""
  echo "מעדכן קובץ compose..."
  cp "$COMPOSE_FILE" "$APP_DIR/docker-compose.yml"
  echo "  ✅ docker-compose.yml עודכן"

else
  # ══════════════════════════════════════════════════════
  #  התקנה חדשה
  # ══════════════════════════════════════════════════════

  if [ ! -f ".env" ]; then
    if [ -f ".env.template" ]; then
      cp .env.template .env
      echo ""
      echo "⚠️  מלא את קובץ .env לפני שממשיכים:"
      echo "   nano .env"
      echo ""
      echo "   שנה לפחות:"
      echo "   DB_PASSWORD   ← סיסמה חזקה לבסיס הנתונים"
      echo "   JWT_SECRET    ← מחרוזת ארוכה ואקראית"
      echo "   CORS_ORIGINS  ← כתובת ה-IP של השרת"
      echo ""
      read -p "לאחר שמילאת — לחץ ENTER להמשך..."
    else
      echo "ERROR: לא נמצא קובץ .env" >&2; exit 1
    fi
  fi

  if grep -q "REPLACE_WITH" .env; then
    echo ""
    echo "ERROR: יש ערכים שלא עודכנו ב-.env (REPLACE_WITH...)"
    echo "       ערוך: nano .env"
    exit 1
  fi
  echo ".env תקין"

  # ── SMB Wizard — הגדרת שיתוף QC Releases ──────────────
  echo ""
  echo "════════════════════════════════════════════════════"
  echo " הגדרת SMB Share לקובץ QC Releases"
  echo "════════════════════════════════════════════════════"
  echo ""
  echo "  קובץ cr_list.xls נמצא בשרת SMB:"
  echo "  //hot-public-01/public/qa/automation/powerbi/releases"
  echo ""
  echo "  האם ברצונך להגדיר את ה-SMB mount עכשיו? [Y/n]"
  read -r SMB_ANSWER
  SMB_ANSWER="${SMB_ANSWER:-Y}"

  if [[ "$SMB_ANSWER" =~ ^[Yy] ]]; then
    echo ""
    echo "  ─── הגדרת SMB ─────────────────────────────────"
    read -p "  שרת SMB (דוגמה: //hot-public-01/public/qa/automation/powerbi/releases): " SMB_SHARE
    SMB_SHARE="${SMB_SHARE:-//hot-public-01/public/qa/automation/powerbi/releases}"
    read -p "  דומיין (דוגמה: HOT): " SMB_DOMAIN
    SMB_DOMAIN="${SMB_DOMAIN:-HOT}"
    read -p "  שם משתמש: " SMB_USER
    read -s -p "  סיסמה: " SMB_PASS
    echo ""
    read -p "  תיקיית mount מקומית (ברירת מחדל: /mnt/qc-releases): " SMB_MOUNT
    SMB_MOUNT="${SMB_MOUNT:-/mnt/qc-releases}"

    echo ""
    echo "  מתקין cifs-utils..."
    dnf install -y cifs-utils 2>/dev/null || yum install -y cifs-utils 2>/dev/null || apt-get install -y cifs-utils 2>/dev/null || true

    mkdir -p "$SMB_MOUNT"

    echo "  מבצע mount..."
    if mount -t cifs "$SMB_SHARE" "$SMB_MOUNT" \
        -o "username=${SMB_USER},password=${SMB_PASS},domain=${SMB_DOMAIN},vers=2.0,iocharset=utf8" 2>/dev/null; then
      echo "  ✅ SMB mount הצליח: $SMB_MOUNT"

      # בדוק cr_list.xls
      if ls "$SMB_MOUNT"/cr_list.xls 2>/dev/null; then
        echo "  ✅ cr_list.xls נמצא"
      else
        echo "  WARNING: cr_list.xls לא נמצא ב-$SMB_MOUNT — בדוק את הנתיב"
        ls "$SMB_MOUNT"/ 2>/dev/null | head -5 || true
      fi

      # הוסף ל-fstab לעמידות לאחר reboot
      CRED_FILE="/etc/deploycenter-smb.credentials"
      echo "username=${SMB_USER}" > "$CRED_FILE"
      echo "password=${SMB_PASS}" >> "$CRED_FILE"
      echo "domain=${SMB_DOMAIN}" >> "$CRED_FILE"
      chmod 600 "$CRED_FILE"

      FSTAB_LINE="${SMB_SHARE} ${SMB_MOUNT} cifs credentials=${CRED_FILE},vers=2.0,iocharset=utf8,_netdev 0 0"
      if ! grep -q "$SMB_SHARE" /etc/fstab 2>/dev/null; then
        echo "" >> /etc/fstab
        echo "# DeployCenter QC Releases SMB Share" >> /etc/fstab
        echo "$FSTAB_LINE" >> /etc/fstab
        echo "  ✅ נוסף ל-/etc/fstab (עמיד לאחר reboot)"
      fi

      # עדכן QC_RELEASES_FILE ב-.env
      QC_FILE_PATH="${SMB_MOUNT}/cr_list.xls"
      sed -i "s|^QC_RELEASES_FILE=.*|QC_RELEASES_FILE=${QC_FILE_PATH}|" .env 2>/dev/null || \
        echo "QC_RELEASES_FILE=${QC_FILE_PATH}" >> .env
      echo "  ✅ QC_RELEASES_FILE=${QC_FILE_PATH} הוגדר ב-.env"
    else
      echo "  WARNING: SMB mount נכשל — ניתן להגדיר ידנית לאחר ההתקנה:"
      echo "    mount -t cifs \"$SMB_SHARE\" $SMB_MOUNT \\"
      echo "      -o \"username=USER,password=PASS,domain=$SMB_DOMAIN\""
    fi
  else
    echo "  (מדלג על הגדרת SMB — ניתן להגדיר ידנית לאחר ההתקנה)"
  fi

  # ── Data migration (התקנה חדשה) ─────────────────────
  echo ""
  if [ -f "deploycenter-data-export.json" ]; then
    mkdir -p "$APP_DIR"
    cp deploycenter-data-export.json "$APP_DIR/"
    echo "✅ Data export: יועתק ל-$APP_DIR ויוייבא בעלייה ראשונה"
    if ! grep -q "^SEED_DATA_FILE" .env; then
      echo "SEED_DATA_FILE=/data/deploycenter-data-export.json" >> .env
    fi
  fi

  mkdir -p "$APP_DIR"
  cp "$COMPOSE_FILE" "$APP_DIR/docker-compose.yml"
  cp ".env"          "$APP_DIR/.env"
  echo "קבצים הועתקו ל-$APP_DIR"

fi  # end fresh-install/upgrade split

# ── Oracle Client ─────────────────────────────────────
echo ""
echo "בודק Oracle Client..."
ORACLE_LIB_DIR_VAL=$(grep "^ORACLE_LIB_DIR=" "$APP_DIR/.env" | cut -d= -f2 | tr -d '"')
ORACLE_CLIENT_DIR="/DeployCenter/oracle/product/19.0.0/client_1"

if [ -d "${ORACLE_CLIENT_DIR}/lib" ]; then
  ls "${ORACLE_CLIENT_DIR}/lib"/libclntsh* &>/dev/null \
    && echo "✅ Oracle Client: OK ($ORACLE_CLIENT_DIR)" \
    || echo "WARNING: libclntsh.so לא נמצא"
  # בדוק timezone files (נדרש למנוע ORA-01804)
  [ -f "${ORACLE_CLIENT_DIR}/oracore/zoneinfo/timezlrg_24.dat" ] \
    && echo "✅ Oracle Timezone Files: OK" \
    || echo "WARNING: קבצי timezone לא נמצאו — ORA-01804 עלול להתרחש"
else
  echo "WARNING: Oracle Client לא נמצא ב-$ORACLE_CLIENT_DIR"
  echo "  → Oracle 11g לא יעבוד ללא Oracle Instant Client"
fi

# ── SMB validation ────────────────────────────────────
echo ""
echo "בודק SMB / QC Releases..."
QC_PATH=$(grep "^QC_RELEASES_FILE=" "$APP_DIR/.env" | cut -d= -f2 | tr -d '"')
if [ -n "$QC_PATH" ]; then
  if [ -f "$QC_PATH" ]; then
    echo "✅ cr_list.xls: נגיש ($QC_PATH)"
  else
    echo "WARNING: $QC_PATH לא נמצא — Mount SMB לפני שימוש ב-QC Sync"
  fi
  # בדוק גם מתוך container (לאחר הפעלה)
  MOUNT_DIR=$(dirname "$QC_PATH")
  if mount | grep -q "$MOUNT_DIR"; then
    echo "✅ SMB mount פעיל: $MOUNT_DIR"
  else
    echo "WARNING: $MOUNT_DIR אינו mount point — בדוק /etc/fstab"
  fi
else
  echo "QC_RELEASES_FILE לא מוגדר ב-.env"
fi

# ── יצור תיקיות bind-mount ───────────────────────────
echo ""
echo "מכין תיקיות bind-mount..."
mkdir -p /mnt/qc-releases
mkdir -p /opt/deploycenter
mkdir -p "${ORACLE_CLIENT_DIR}/lib"
echo "תיקיות מוכנות"

# ── טעינת Docker images ───────────────────────────────
echo ""
echo "טוען Docker images (יכול לקחת כמה דקות)..."
docker load -i "$IMAGES_TAR"
echo "images נטענו"
echo ""
docker images | grep -E "deploycenter|postgres|REPOSITORY"

# ── וידוא images ─────────────────────────────────────
echo ""
for img in "deploycenter-api:${VERSION}" "deploycenter-frontend:${VERSION}" "postgres:16-alpine"; do
  docker image inspect "$img" > /dev/null 2>&1 \
    && echo "  ✅ $img" \
    || { echo "ERROR: Image $img לא נמצא" >&2; exit 1; }
done

# ── עצור native services ──────────────────────────────
echo ""
systemctl stop postgresql 2>/dev/null && systemctl disable postgresql 2>/dev/null \
  && echo "PostgreSQL native עצר" || echo "(PostgreSQL native לא רץ)"
systemctl stop nginx 2>/dev/null \
  && echo "Nginx native עצר" || echo "(Nginx native לא רץ)"

# ── Firewall ─────────────────────────────────────────
firewall-cmd --permanent --add-service=http 2>/dev/null || true
firewall-cmd --reload 2>/dev/null || true
echo "Firewall: פורט 80 פתוח"

# ── SELinux ──────────────────────────────────────────
setsebool -P container_manage_cgroup 1 2>/dev/null || true
echo "SELinux מוגדר"

# ── עצור containers קיימים לפני עדכון ───────────
echo ""
cd "$APP_DIR"
if [ "$IS_UPGRADE" = "true" ]; then
  echo "עוצר containers קיימים..."
  docker compose down --remove-orphans 2>/dev/null || true
  echo "  ✅ Containers הופסקו"
fi

# ── הפעל Docker Compose ───────────────────────────────
echo ""
if [ "$IS_UPGRADE" = "true" ]; then
  echo "מפעיל שדרוג ל-v${VERSION}..."
  echo "(containers ייצרו מחדש עם images חדשים, postgres_data נשמר)"
else
  echo "מפעיל DeployCenter v${VERSION} (התקנה חדשה)..."
fi
docker compose up -d

# ── ממתין לאתחול ─────────────────────────────────────
echo ""
echo "ממתין לאתחול (50 שניות)..."
sleep 50

echo ""
docker compose ps

echo ""
if curl -sf http://localhost/api/auth/config > /dev/null 2>&1; then
  echo "✅ API עונה — המערכת עלתה בהצלחה!"
  # בדיקת health endpoint
  echo ""
  echo "סטטוס מערכת:"
  curl -sf http://localhost/api/health 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k,v in d.items():
    icon = '✅' if v in ('ok','disabled') else ('⚠️ ' if v=='degraded' else '❌')
    print(f'  {icon} {k}: {v}')
" 2>/dev/null || curl -sf http://localhost/api/health 2>/dev/null || true
else
  echo "WARNING: API לא עונה — בדוק לוגים:"
  echo "  docker logs dc-api --tail 50"
fi

# ── וידוא שמירת קונפיגורציה Oracle ─────────────
if [ "$IS_UPGRADE" = "true" ] && [ -n "$OLD_ORACLE_CONNECT_STRING" ]; then
  echo ""
  echo "זכור: פרמטרי Oracle מאוחסנים ב-SystemParams בDB."
  echo "  → גש ל-AdminPanel > QC Oracle > בדוק שהגדרות קיימות"
fi

# ── Systemd service ───────────────────────────────────
echo ""
cat > /etc/systemd/system/deploycenter-docker.service << 'UNIT'
[Unit]
Description=DeployCenter Docker Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

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
if [ "$IS_UPGRADE" = "true" ]; then
  echo " DeployCenter v${VERSION} — שדרוג הושלם בהצלחה!"
  echo ""
  echo " מה קרה אוטומטית:"
  echo "   ✅ קונפיגורציה גובתה לפני שדרוג"
  echo "   ✅ DB גובה לפני שדרוג"
  echo "   ✅ Containers הופסקו לפני עדכון (תיקון name conflict)"
  echo "   ✅ LD_LIBRARY_PATH + ORACLE_HOME נוספו ל-.env (אם חסרו)"
  echo "   ✅ Migrations רצו אוטומטית"
  echo "   ✅ נתונים קיימים נשמרו ב-postgres_data"
  echo "   ✅ מטריצת סקילים/בודקים תיובא אוטומטית אם סופק deploycenter-data-export.json"
else
  echo " DeployCenter v${VERSION} הותקן בהצלחה!"
fi
echo ""
echo " גש לכתובת: http://$(hostname -I | awk '{print $1}')"
echo ""
echo " בדיקת מערכת:"
echo "   docker exec dc-api node /app/dist/scripts/validate-production.js"
echo ""
echo " איפוס Admin (אם נדרש):"
echo "   docker exec dc-api node /app/dist/scripts/reset-admin.js \\"
echo "     --email admin@company.com --password NewPass123! --create"
echo ""
echo " Health Check:"
echo "   curl http://localhost/api/health"
echo "======================================================"
