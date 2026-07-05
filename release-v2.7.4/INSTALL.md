# DeployCenter 2.7.4 — מדריך התקנה ושדרוג

> **סביבת ייצור:** RHEL 9.7 | Docker Engine 26 | PostgreSQL 16 | Oracle 11g (11.2.0.3)

---

## תוכן עניינים

1. [דרישות מקדימות](#1-דרישות-מקדימות)
2. [Oracle Client Prerequisites](#2-oracle-client-prerequisites)
3. [SMB Share Configuration](#3-smb-share-configuration)
4. [התקנה חדשה](#4-התקנה-חדשה)
5. [שדרוג מ-2.7.x](#5-שדרוג-מ-27x)
6. [Oracle Thick Mode Configuration](#6-oracle-thick-mode-configuration)
7. [QC Configuration](#7-qc-configuration)
8. [Template + Skills Matrix Migration](#8-template--skills-matrix-migration)
9. [Health Validation](#9-health-validation)
10. [Recovery Procedure](#10-recovery-procedure)
11. [פקודות שימושיות](#11-פקודות-שימושיות)

---

## 1. דרישות מקדימות

```bash
# Docker Engine
sudo dnf install -y docker-ce docker-ce-cli
sudo systemctl enable --now docker

# cifs-utils (לSMB mount)
sudo dnf install -y cifs-utils

# libaio (נדרש ל-Oracle Instant Client)
sudo dnf install -y libaio
```

**קבצי הגרסה (מדיסק אחסון / USB):**

```
release-v2.7.4/
├── deploycenter-docker-v2.7.4.tar      ← Docker images (API + Frontend + PostgreSQL)
├── deploycenter-data-export.json       ← Users/Teams/Templates/Permissions/System Params + מטריצת סקילים
├── docker-compose.offline.yml          ← הגדרות containers
├── .env.template                       ← תבנית קובץ .env (להתקנה חדשה בלבד)
├── install-docker.sh                   ← סקריפט התקנה/שדרוג
└── INSTALL.md                          ← מסמך זה
```

---

## 2. Oracle Client Prerequisites

Oracle 11g דורש **Thick Mode** — לא ניתן לעבוד עם Thin Mode.

### מבנה תיקיות נדרש על השרת:

```
/DeployCenter/oracle/product/19.0.0/client_1/
├── lib/
│   ├── libclntsh.so        ← חובה
│   ├── libnnz19.so         ← חובה
│   └── libclntshcore.so    ← חובה
└── oracore/
    └── zoneinfo/
        └── timezlrg_24.dat ← נדרש למניעת ORA-01804
```

### הגדרות סביבה נדרשות (ב-.env):

```bash
ORACLE_LIB_DIR=/oracle/lib      # נתיב ל-lib בתוך container
ORACLE_HOME=/oracle/client      # נתיב לOracle Home בתוך container
LD_LIBRARY_PATH=/oracle/lib     # נדרש ל-libnnz19.so (DPI-1047)
```

> ⚠️ **חשוב:** `ORACLE_ENABLED` הוא **לא** משתנה סביבה — הוא נשלף אך ורק מפרמטר שמור במסד הנתונים (SystemParam). הגדרתו ב-`.env` לא משפיעה בכלל. יש להפעיל אותו דרך **AdminPanel → QC Oracle** (ראה סעיף 6).

### בדיקת Oracle Client:

```bash
# בדוק שהקבצים קיימים
ls /DeployCenter/oracle/product/19.0.0/client_1/lib/libclntsh*
ls /DeployCenter/oracle/product/19.0.0/client_1/oracore/zoneinfo/timezlrg_24.dat

# בדוק מתוך container לאחר הפעלה
docker exec dc-api ls /oracle/lib/libclntsh*
docker exec dc-api ls /oracle/client/oracore/zoneinfo/
```

---

## 3. SMB Share Configuration

DeployCenter מסונכרן מקובץ `cr_list.xls` הנמצא בשרת SMB.

### Mount ידני:

```bash
# צור תיקיית mount
sudo mkdir -p /mnt/qc-releases

# Mount (החלף USER ו-PASS)
sudo mount -t cifs "//hot-public-01/public/qa/automation/powerbi/releases" \
  /mnt/qc-releases \
  -o "username=USER,password=PASS,domain=HOT,vers=2.0,iocharset=utf8"

# בדוק
ls /mnt/qc-releases/cr_list.xls
```

### עמידות לאחר Reboot (fstab):

```bash
# שמור credentials
sudo bash -c 'cat > /etc/deploycenter-smb.credentials <<EOF
username=USER
password=PASS
domain=HOT
EOF'
sudo chmod 600 /etc/deploycenter-smb.credentials

# הוסף ל-/etc/fstab
echo "//hot-public-01/public/qa/automation/powerbi/releases /mnt/qc-releases \
cifs credentials=/etc/deploycenter-smb.credentials,vers=2.0,iocharset=utf8,_netdev 0 0" \
  | sudo tee -a /etc/fstab

# בדוק
sudo mount -a
ls /mnt/qc-releases/cr_list.xls
```

### בדיקת גישה מתוך container:

```bash
docker exec dc-api ls -la /mnt/qc-releases/
# חייב להראות: cr_list.xls
```

---

## 4. התקנה חדשה

```bash
# 1. העתק קבצים מדיסק אחסון (USB)
cd /tmp/release-v2.7.4

# 2. צור קובץ .env
cp .env.template .env
nano .env
# ערוך: DB_PASSWORD, JWT_SECRET, CORS_ORIGINS

# 3. הרץ installer (כולל SMB Wizard אוטומטי)
sudo bash install-docker.sh
```

**ה-installer:**
- שואל אם להגדיר SMB mount (ממליץ Y)
- טוען Docker images
- מריץ migrations אוטומטית
- מייבא users/teams/templates/מטריצת-סקילים מ-`deploycenter-data-export.json`
- מפעיל systemd service לאתחול אוטומטי

---

## 5. שדרוג מ-2.7.x

```bash
# 1. העתק קבצים חדשים לתיקייה זמנית
cd /tmp/upgrade-274

# 2. הרץ installer (מזהה שדרוג אוטומטית)
sudo bash install-docker.sh
```

**מה קורה אוטומטית בשדרוג:**
- גיבוי DB לפני שדרוג: `/opt/deploycenter/backup-pre-2.7.4-DATE.sql`
- גיבוי קונפיגורציה: `/opt/deploycenter/config-backup-pre-2.7.4-DATE.env`
- עצירת containers קיימים (`docker compose down`) — מונע שגיאת name conflict
- אין משתני `.env` חדשים בגרסה זו (כל השינויים ב-2.7.4 הם ב-DB/קוד בלבד)
- שחזור ערכי Oracle קיימים (ORACLE_ENABLED, ORACLE_CONNECT_STRING וכו')
- הפעלת migrations חדשות: `RunbookEntry.runDate`, `RunbookEntry.employeeUserId`, `RunbookEntry.notified15MinAt`
- ייבוא `deploycenter-data-export.json` — upsert-בלבד, כולל מטריצת הסקילים/בודקים (מ-2.7.3 ואילך)
- הפעלת containers עם images חדשים

**מה חדש ב-2.7.4:**
- לוח הפעילויות (QaActivityPlanView): כפתור 📅 לקביעת פגישה ביומן אמיתית (ICS, תואם Outlook/Google Calendar) לכל פעילות — נשלח דרך אותה תצורת SMTP הקיימת ב-**AdminPanel → מייל**
- Runbook: מצב הרצה חי ("▶ הפעל במצב הרצה") עם עדכון סטטוס בזמן אמת לכל שלב
- התראת מערכת אוטומטית ~15 דקות לפני תחילת כל שלב Runbook (job מתוזמן, רץ כל דקה — לא דורש קונפיגורציה נוספת)
- דף הבית: "הפעולות הבאות שלך" מציג כעת כל פעילות מלוח הפעילויות שמתקיימת היום/מחר, כולל לינק ישיר להרצת Runbook כשרלוונטי — גם למנהל הלילה/מנהל המערכת שאין להם גישה רגילה למודול ה-QA

> **שדרוג בטוח מבחינת נתונים:** הייבוא הוא upsert-בלבד — לא מוחק שום דבר. משתמשים/צוותים/הרשאות/סקילים קיימים בשרת היעד נשמרים ורק מתעדכנים/מתווספים.
>
> **בדיקה לאחר שדרוג:** ודא ש-**AdminPanel → מייל** מוגדר עם SMTP תקין (נדרש הן לזימוני יומן והן להתראות הקיימות) — אחרת שליחת זימון תיכשל עם שגיאה ברורה (400, לא 500).

---

## 6. Oracle Thick Mode Configuration

### בדיקת Thick Mode:

```bash
# בדוק שמצב Oracle הוא THICK
docker logs dc-api 2>&1 | grep -E "Oracle Mode|Oracle Client|Oracle Home"
# צפוי:
#   Oracle Mode   : THICK
#   Oracle Client : 19.0.0.0.0
#   Oracle Home   : /oracle/client
```

### הגדרת חיבור Oracle דרך AdminPanel:

1. גש ל-**AdminPanel → QC Oracle**
2. וודא שהתג העליון מציג "✓ מחובר" (לא "Mock") — אם מציג Mock, לחץ ✏️ ליד `ORACLE_ENABLED` והזן `true`
3. הגדר:
   - `ORACLE_USER` = שם המשתמש ב-QC DB
   - `ORACLE_PASSWORD` = סיסמה
   - `ORACLE_CONNECT_STRING` = `qcdb01:1521/QCPROD`
4. שמור — הערכים נכנסים לתוקף מיידית, ללא restart

### בדיקת חיבור מ-CLI:

```bash
curl -s -X POST http://localhost/api/health/test-oracle \
  -H "Content-Type: application/json" \
  -d '{"user":"ORACLE_USER","password":"ORACLE_PASS","connectString":"host:1521/sid"}'
# תוצאה: {"ok":true,"message":"חיבור Oracle הצליח"}
```

---

## 7. QC Configuration

### הגדרת נתיב קובץ QC (AdminPanel):

1. **AdminPanel → QC Oracle** → הגדר `QC_RELEASES_FILE` = `/mnt/qc-releases/cr_list.xls`
2. לחץ **Test File** — חייב להחזיר ✅

### סנכרון ידני:

```bash
curl -s -X POST http://localhost/api/qc-releases/sync-excel \
  -H "Authorization: Bearer TOKEN"
```

---

## 8. Template + Skills Matrix Migration

הדרך המומלצת: `deploycenter-data-export.json` (סעיף 4/5 לעיל) — מייבא הכל אוטומטית בעליית ה-container, כולל תבניות גרסה ומטריצת הסקילים.

לחלופין — ייבוא ממוקד רק לתבניות (ללא שאר הנתונים):

### ייצוא תבניות מ-DEV:

```bash
# על מחשב הפיתוח
cd backend
NODE_ENV=dev npx ts-node scripts/templates-export.ts ./templates-export.json
```

### ייבוא תבניות ל-PROD (דרך Docker):

```bash
docker cp templates-export.json dc-api:/tmp/
docker exec dc-api node /app/dist/scripts/templates-import.js /tmp/templates-export.json
```

### בדיקת מטריצת הסקילים לאחר ייבוא:

```bash
# ספירת סקילים/בודקים/רשומות מטריצה שיובאו
docker exec dc-api node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
Promise.all([p.skill.count(), p.testerProfile.count(), p.testerSkill.count()])
  .then(([skills, testers, matrix]) => console.log({ skills, testers, matrix }))
  .finally(() => p.\$disconnect());
"
```

או פשוט ב-UI: **ניהול QA → מטריצת סקילים** — ודא שהעמודות/שורות מולאו כצפוי.

---

## 9. Health Validation

### בדיקת Health Endpoint:

```bash
curl http://localhost/api/health
```

**תוצאה צפויה:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-04T10:00:00.000Z",
  "version": "2.7.4",
  "database": "ok",
  "oracle": "ok",
  "cr_list": "ok"
}
```

| ערך | משמעות |
|-----|--------|
| `ok` | תקין |
| `disabled` | Oracle מנוטרל (ORACLE_ENABLED=false בטבלת SystemParam) |
| `not_configured` | QC_RELEASES_FILE לא הוגדר |
| `error` | תקלה — בדוק `oracle_error` / `cr_list_error` |

### בדיקה מלאה:

```bash
docker exec dc-api node /app/dist/scripts/validate-production.js
```

### Checklist לפני Go-Live:

```
✅ PostgreSQL Connectivity
✅ Oracle Client (Thick Mode)
✅ Oracle Connectivity
✅ ORACLE_HOME set
✅ LD_LIBRARY_PATH set
✅ Oracle Timezone Files
✅ SMB Share mounted
✅ cr_list.xls accessible
✅ QC Connectivity
✅ System Parameters
✅ Users imported
✅ Admin user exists
✅ Skills matrix imported (Skill / TesterProfile / TesterSkill)
```

---

## 10. Recovery Procedure

### איפוס סיסמת Admin:

```bash
# מתוך הcontainer
docker exec dc-api node /app/dist/scripts/reset-admin.js \
  --email admin@company.com \
  --password NewSecurePass123!

# יצירת Admin חדש (אם לא קיים)
docker exec dc-api node /app/dist/scripts/reset-admin.js \
  --email admin@company.com \
  --password NewSecurePass123! \
  --create \
  --name "System Admin"
```

### Rollback — חזרה לגרסה קודמת:

```bash
# 1. עצור containers
docker compose -f /opt/deploycenter/docker-compose.yml down

# 2. שחזר backup DB
docker compose -f /opt/deploycenter/docker-compose.yml up -d dc-postgres
sleep 10
cat /opt/deploycenter/backup-pre-2.7.4-DATE.sql | docker exec -i dc-postgres \
  psql -U dcuser deploycenter

# 3. החזר images ישנים (אם שמרת)
docker load -i deploycenter-docker-v2.7.3.tar

# 4. עדכן compose לversion הישנה ועלה מחדש
```

---

## 11. פקודות שימושיות

```bash
# לוגים
docker logs dc-api --tail 50 --follow
docker logs dc-api 2>&1 | grep -E "FATAL|ERROR|Oracle|Migrations|READY"

# סטטוס
docker compose -f /opt/deploycenter/docker-compose.yml ps

# בדיקות
curl http://localhost/api/health
curl http://localhost/api/auth/config  # public endpoint

# Oracle Test
curl -X POST http://localhost/api/health/test-oracle \
  -H "Content-Type: application/json" \
  -d '{"user":"U","password":"P","connectString":"H:1521/S"}'

# SMB Test
curl -X POST http://localhost/api/health/test-cr-list \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/mnt/qc-releases/cr_list.xls"}'

# Admin Recovery
docker exec dc-api node /app/dist/scripts/reset-admin.js \
  --email EMAIL --password PASS --create

# Template Migration
docker cp templates-export.json dc-api:/tmp/
docker exec dc-api node /app/dist/scripts/templates-import.js /tmp/templates-export.json

# Validate Production
docker exec dc-api node /app/dist/scripts/validate-production.js

# Backup DB
docker exec dc-postgres pg_dump -U dcuser deploycenter \
  > /opt/deploycenter/backup-$(date +%Y%m%d-%H%M).sql
```
