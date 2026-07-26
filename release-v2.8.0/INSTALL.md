# DeployCenter 2.8.0 — מדריך התקנה ושדרוג

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
release-v2.8.0/
├── deploycenter-docker-v2.8.0.tar      ← Docker images (API + Frontend + PostgreSQL)
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
cd /tmp/release-v2.8.0

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
cd /tmp/upgrade-280

# 2. הרץ installer (מזהה שדרוג אוטומטית)
sudo bash install-docker.sh
```

**מה קורה אוטומטית בשדרוג:**
- גיבוי DB לפני שדרוג: `/opt/deploycenter/backup-pre-2.8.0-DATE.sql`
- גיבוי קונפיגורציה: `/opt/deploycenter/config-backup-pre-2.8.0-DATE.env`
- עצירת containers קיימים (`docker compose down`) — מונע שגיאת name conflict
- **4 migrations חדשות בגרסה זו, ללא משתני `.env` חדשים** — כולן תוספתיות בלבד (`ADD COLUMN` nullable/עם default, ערך enum חדש), ולא הורסות/דורסות נתונים קיימים. נבדק ואומת: כל 33 ה-migrations רצות נקי מול DB ריק לגמרי, ואפס סטייה (`prisma migrate diff`) מול `schema.prisma`:
  - `20260722_leave_request_cancel_audit` — ערך enum חדש `CANCELLED` ל-`LeaveStatus`, ועמודות audit (`decidedByName/At`, `cancelledByName/At/cancelReason`) ל-`LeaveRequest`
  - `20260722b_version_cr_qa_arrival` — `qaArrivalDate`/`qaReceived`/`qaReceivedAt` ל-`VersionCrAssignment`
  - `20260723_qa_cycle_task_archive` — `isArchived` (default `false`) ל-`QaCycleTask`
  - `20260724_version_dates_locked_to_workplan` — `datesLockedToWorkPlan` (default `false`) ל-`Version` — ברירת המחדל `false` חלה על **כל** הגרסאות הקיימות בשרת; ההתנהגות החדשה (ראו למטה) חלה רק על גרסאות שייווצרו **אחרי** השדרוג
  מוחלות אוטומטית ע"י `prisma migrate deploy` בעת עליית ה-container (`docker-entrypoint.sh`) — אין פעולה ידנית נדרשת.
- שחזור ערכי Oracle קיימים (ORACLE_ENABLED, ORACLE_CONNECT_STRING וכו')
- ייבוא `deploycenter-data-export.json` — upsert-בלבד, כולל מטריצת הסקילים/בודקים
- הפעלת containers עם images חדשים

**אין שינוי הרשאות בגרסה זו.**

**מה חדש ב-2.8.0:**

*נעילת תאריך עלייה לאוויר לתוכנית QA (שינוי התנהגות — גרסאות חדשות בלבד):* עבור גרסה שנוצרת מעכשיו ואילך, ברגע שתוכנית עבודת QA נכתבת, `plannedStart` (העלייה לאוויר) מתמלא אוטומטית פעם אחת מהמחזור `GO_LIVE` — ולאחר מכן קפוא: שינויים נוספים בתוכנית ה-QA (שיבוץ מחדש, שינוי מאמץ, ארכוב) לא דורסים אותו יותר, אלא נבדקים מולו (אזהרת חריגה). תאריכי `integrationStart/End`, `qaStart/End`, `plannedRehearsalStart/End` ממשיכים להסתנכרן אוטומטית מהתוכנית בכל שינוי, ולא ניתנים לעריכה ישירה ברגע שקיימת תוכנית QA. גרסאות קיימות (`datesLockedToWorkPlan=false`) אינן מושפעות כלל.

*ביטול בקשות חופשה + audit trail:* עובד יכול לבטל בקשת חופשה משלו גם אחרי שאושרה (לא נמחקת — מסומנת `CANCELLED` עם שם המבטל ותאריך); מנהל יכול גם הוא לבטל בקשה בכל שלב. נשמר כעת גם מי אישר/דחה בקשה ומתי.

*מעקב הגעת CR ל-QA:* תאריך הגעה צפוי (`qaArrivalDate`) לכל CR, ואישור הגעה בפועל (`qaReceived`) — דף הבית מסמן CR-ים שעבר תאריך ההגעה הצפוי שלהם ואינם מסומנים כהתקבלו.

*ארכוב/שחזור משימות QA:* ניתן להסתיר משימת QA (עם סיבה) מהלוח הפעיל ולשחזר אותה מאוחר יותר — עם לוג שינויים מלא (מי, מתי, למה).

*מודול "ניהול גרסה" — מסך סקירה כללית (חדש):* תת-תצוגה חדשה שמציגה במבט אחד: 4 שלבי מחזור החיים של הגרסה (פתיחה/תכולה/אישור/שינויים) עם תקציר אמיתי לכל שלב, כרטיס מרוכז לכל תאריכי הגרסה (אינטגרציה/QA/עלייה לאוויר/ישיבות/מועדי הגשה), והערכת מאמץ כוללת — במקום לפתוח תמיד על השלב האחרון שנצפה. זו כעת ברירת המחדל בכניסה למודול מהסיידבר.

*מסך "פתיחת גרסה" — כל תאריכי הגרסה במקום אחד:* נוספו לשם שדות `qaStart/qaEnd`, ישיבת סקירה, ישיבת תוכנית עבודה, ומועדי הגשה/אישור תוכניות — לצד תאריכי האינטגרציה ועלייה לאוויר שכבר היו שם. שדות המנוהלים ע"י תוכנית ה-QA (ראו למעלה) מוצגים כקריאה-בלבד עם הסבר, כשרלוונטי.

> **שדרוג בטוח מבחינת נתונים:** הייבוא הוא upsert-בלבד — לא מוחק שום דבר. משתמשים/צוותים/סקילים קיימים בשרת היעד נשמרים ורק מתעדכנים/מתווספים. כל 4 ה-migrations החדשות תוספתיות בלבד (עמודות nullable/עם default, ערך enum חדש) ולא נוגעות בנתונים קיימים — גרסאות קיימות ב-DB ממשיכות לעבוד בדיוק כמו קודם (`datesLockedToWorkPlan` ברירת המחדל `false`).
>
> **בדיקה לאחר שדרוג:** ודא שאפשר לבטל בקשת חופשה מאושרת ושהביטול מוצג עם שם המבטל; שדף הבית מסמן CR-ים באיחור הגעה ל-QA; שאפשר לארכב/לשחזר משימת QA; שכניסה ל"ניהול גרסה" מהסיידבר נוחתת על "סקירה כללית"; ושליצירת גרסה חדשה, שיוך תוכנית QA אליה נועל את תאריך העלייה לאוויר כמצופה (ואילו גרסאות ישנות ממשיכות לאפשר עריכה חופשית של כל התאריכים).

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
  "timestamp": "2026-07-06T10:00:00.000Z",
  "version": "2.8.0",
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
✅ TEAM_LEAD role has screen:qa permission (AdminPanel → הרשאות לפי תפקיד)
✅ ADMIN/RELEASE_MANAGER roles have screen:release-intelligence + screen:quality-hub permission (new in 2.8.0 — auto-applied by the standard data-export import, but re-check if this server has custom per-role permissions)
✅ QC release-list sync works via Oracle (Excel-only sync path was removed in 2.8.0)
✅ Quality Hub KPI Definitions + KPI Scores imported (empty on fresh install/upgrade until imported)
✅ Navigation to a version (home, sidebar, closed versions) works without bouncing back
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
cat /opt/deploycenter/backup-pre-2.8.0-DATE.sql | docker exec -i dc-postgres \
  psql -U dcuser deploycenter

# 3. החזר images ישנים (אם שמרת)
docker load -i deploycenter-docker-v2.7.9.tar

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
