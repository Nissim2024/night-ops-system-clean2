# DeployCenter 2.8.1 — מדריך התקנה ושדרוג

> **סביבת ייצור:** RHEL 9.7 | Docker Engine 26 | PostgreSQL 16 | Oracle 11g (11.2.0.3)

---

## תוכן עניינים

1. [דרישות מקדימות](#1-דרישות-מקדימות)
2. [Oracle Client Prerequisites](#2-oracle-client-prerequisites)
3. [SMB Share Configuration](#3-smb-share-configuration)
4. [התקנה חדשה](#4-התקנה-חדשה)
5. [שדרוג מ-2.8.x](#5-שדרוג-מ-28x)
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
release-v2.8.1/
├── deploycenter-docker-v2.8.1.tar      ← Docker images (API + Frontend + PostgreSQL)
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
cd /tmp/release-v2.8.1

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

## 5. שדרוג מ-2.8.x

```bash
# 1. העתק קבצים חדשים לתיקייה זמנית
cd /tmp/upgrade-281

# 2. הרץ installer (מזהה שדרוג אוטומטית)
sudo bash install-docker.sh
```

**מה קורה אוטומטית בשדרוג:**
- גיבוי DB לפני שדרוג: `/opt/deploycenter/backup-pre-2.8.1-DATE.sql`
- גיבוי קונפיגורציה: `/opt/deploycenter/config-backup-pre-2.8.1-DATE.env`
- עצירת containers קיימים (`docker compose down`) — מונע שגיאת name conflict
- **migration חדשה אחת בגרסה זו, ללא משתני `.env` חדשים** — תוספתית בלבד (`ADD COLUMN` nullable), לא הורסת/דורסת נתונים קיימים. נבדק ואומת: כל 34 ה-migrations רצות נקי מול DB ריק לגמרי, ואפס סטייה (`prisma migrate diff`) מול `schema.prisma`:
  - `20260727_version_cr_actual_effort_days` — `actualEffortDays` (עמודה מספרית, nullable) ל-`VersionCrAssignment` — הערך המספרי בפועל מעמודת "Actuals" ב-CR_LIST (לעומת `hasActual` הקיים, שמזהה רק V/X)
  מוחלת אוטומטית ע"י `prisma migrate deploy` בעת עליית ה-container (`docker-entrypoint.sh`) — אין פעולה ידנית נדרשת.
- שחזור ערכי Oracle קיימים (ORACLE_ENABLED, ORACLE_CONNECT_STRING וכו')
- ייבוא `deploycenter-data-export.json` — upsert-בלבד, כולל מטריצת הסקילים/בודקים
- הפעלת containers עם images חדשים

**אין שינוי הרשאות בגרסה זו.**

**מה חדש ב-2.8.1:**

*Treemap במודול ניהול גרסה — ערכים אמיתיים לפי CR:* הבליטות בתרשים מייצגות כעת כל CR בנפרד (לא קיבוץ לפי מאפיין), עם tooltip שמציג את ימי המאמץ בפועל שדווחו (`actualEffortDays`, ראו migration למעלה) ואת האחוז שלו מתוך סך הכל.

*ספירת CR ליבה/Stand Alone — מקור אמת אחיד:* "ליבה" הפכה מתיוג ידני לגזירה אוטומטית — `coreCrCount = crCount - saCrCount`, וה-SA מחושב תוך כיבוד override ברמת שיבוץ ה-QA (לא רק ברמת הגרסה). ספירות ה-KPI בדף הבית תואמות כעת בדיוק למספרים במודול ניהול גרסה עצמו.

*רשימות CR/TARGET ומסך פרטי CR — ניווט מסך-מלא:* רשימת CR, רשימת TARGET, פרטי CR והיסטוריית שינויים עברו מחלונות מודאליים לניווט מסך-מלא עם כפתור חזרה; נוסף בורר עמודות ("בחירת עמודות"); טבלת תקלות TARGET מיושרת RTL.

*ביצועים — מסך השיבוץ ורשימת ה-CR:* קובץ ה-Excel של CR_LIST (כ-8,000 שורות, ~1.3 שניות לפענוח) נשמר כעת בזיכרון (invalidation אוטומטי כשהקובץ עצמו משתנה בדיסק — אין צורך ב-restart). כל פתיחת פרטי CR, לחיצת היסטוריית שינויים, וסנכרון במסך השיבוץ נהנים מהמטמון במקום לפענח את הקובץ מחדש בכל קליק. נוסף גם פרמטר מערכת חדש (`CR_LIST_SYNC_TIME`, ניתן לעריכה ב-AdminPanel → System Params, ברירת מחדל `00:15`) לתזמון סנכרון לילי אוטומטי של CR_LIST.

*מסך "התקדמות סבבים" חדש (Release Intelligence):* כרטיס לכל סבב עם ספירה לאחור חיה לתאריך הסיום, וקו התקדמות המבוסס על אחוז כיסוי בדיקות אמיתי מול יעד ה-QG של הסבב (לא זמן שנותר) — לחיצה על "הצג פירוט" עוברת למסך מלא עם פירוט התקדמות לפי כל CR בנפרד.

*תזמון סבב Stand Alone (SA) בתוכנית עבודת QA — תוקן:* סבב ה-SA היה מתוזמן החל מתאריך "היום" האמיתי בזמן יצירת/רענון התוכנית, ולא מתאריכי הגרסה עצמה — מה שיצר תזמון מנותק מהמציאות עבור גרסאות שתוכננו מחדש. כעת: (א) סבב ה-SA תחום לתאריכי הגרסה (מתחיל יחד עם סבב 1); (ב) חריגה מעבר לתאריך סיום הבדיקות מתאפשרת רק כשאין מספיק קיבולת בודקים בפועל, ומוצגת כאזהרה מפורשת בתוכנית העבודה (`SA_TESTING_END_OVERFLOW`) במקום להישאר סמויה; (ג) CR שסומן "דחוף" מתוזמן בתחילת חלון הבדיקות (יחד עם תחילת סבב 1); (ד) שיבוץ המשימות לכל בודק תמיד מכבד סדר עדיפויות — דחוף, ואז בעל תאריך יעד (ממויין לפי תאריך), ואז השאר; (ה) תאריך "הגעה ל-QA" הצפוי של CR (`qaArrivalDate`), כשמוגדר, הוא אילוץ תחילת-שיבוץ מינימלי — ה-CR לא ישובץ לפני התאריך הזה גם אם יש קיבולת פנויה.

*תיקון תצוגת טווחי תאריכים (bidi) בכרטיסי הסבב:* תאריכי התחלה/סיום כבר לא מוצגים הפוכים חזותית במסכי RTL.

> **שדרוג בטוח מבחינת נתונים:** הייבוא הוא upsert-בלבד — לא מוחק שום דבר. משתמשים/צוותים/סקילים קיימים בשרת היעד נשמרים ורק מתעדכנים/מתווספים. ה-migration החדשה תוספתית בלבד (עמודה מספרית nullable) ולא נוגעת בנתונים קיימים — כל שאר השינויים בגרסה זו הם קוד בלבד (חישוב מחדש של ערכים קיימים, לוגיקת תזמון, ותצוגה) וללא שינוי סכימה נוסף.
>
> **בדיקה לאחר שדרוג:** ודא שה-treemap במודול ניהול גרסה מציג ימי מאמץ אמיתיים ולא ריק; שספירת CR-י הליבה/SA בדף הבית זהה למודול ניהול גרסה; שרשימת CR/TARGET ופרטי CR נפתחים במסך מלא עם כפתור חזרה תקין; שפרמטר `CR_LIST_SYNC_TIME` מופיע וניתן לעריכה ב-AdminPanel; שמסך "התקדמות סבבים" ב-Release Intelligence מציג התקדמות לפי כיסוי (לא זמן) עם קו יעד; ושתוכנית עבודת QA שנוצרת מחדש לגרסה קיימת מייצרת סבב Stand Alone שמתחיל בתאריכי הגרסה עצמה (לא בתאריך היום).

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
  "version": "2.8.1",
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
cat /opt/deploycenter/backup-pre-2.8.1-DATE.sql | docker exec -i dc-postgres \
  psql -U dcuser deploycenter

# 3. החזר images ישנים (אם שמרת)
docker load -i deploycenter-docker-v2.8.0.tar

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
