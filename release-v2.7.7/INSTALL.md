# DeployCenter 2.7.7 — מדריך התקנה ושדרוג

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
release-v2.7.7/
├── deploycenter-docker-v2.7.7.tar      ← Docker images (API + Frontend + PostgreSQL)
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
cd /tmp/release-v2.7.7

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
cd /tmp/upgrade-277

# 2. הרץ installer (מזהה שדרוג אוטומטית)
sudo bash install-docker.sh
```

**מה קורה אוטומטית בשדרוג:**
- גיבוי DB לפני שדרוג: `/opt/deploycenter/backup-pre-2.7.7-DATE.sql`
- גיבוי קונפיגורציה: `/opt/deploycenter/config-backup-pre-2.7.7-DATE.env`
- עצירת containers קיימים (`docker compose down`) — מונע שגיאת name conflict
- **7 migrations חדשות בגרסה זו, ללא משתני `.env` חדשים** — כולן תוספתיות (`ADD COLUMN` nullable/עם default, או `CREATE TABLE` חדשה), לא הורסות נתונים קיימים: `20260709_add_release_intelligence`, `20260714_add_leave_request_group_id`, `20260714a_add_quality_hub`, `20260714b_add_release_kpi_score_qualitative_note`, `20260714c_add_runbook_template`, `20260714d_add_go_no_go_decision`, `20260714e_add_release_insight_manual_fields`. מוחלות אוטומטית ע"י `prisma migrate deploy` בעת עליית ה-container (`docker-entrypoint.sh`) — אין פעולה ידנית נדרשת.
- שחזור ערכי Oracle קיימים (ORACLE_ENABLED, ORACLE_CONNECT_STRING וכו')
- ייבוא `deploycenter-data-export.json` — upsert-בלבד, כולל מטריצת הסקילים/בודקים
- הפעלת containers עם images חדשים

**⚠ פעולה ידנית נדרשת אחרי השדרוג — הרשאות למודולים החדשים:**
נוספו 2 מסכי-הרשאה חדשים: `screen:release-intelligence` ו-`screen:quality-hub`. זרעוע ברירת המחדל (`ensureDefaults`) מוסיף שורת RolePermission חדשה **רק לתפקיד שאין לו שורה בכלל** — בשרת קיים ששודרג, לתפקידים הקיימים (כולל ADMIN) **לא** תתווסף ההרשאה אוטומטית. יש להיכנס ל-**AdminPanel → הרשאות לפי תפקיד** ולהעניק את שני המסכים הללו לתפקידים הרלוונטיים (לפחות ADMIN ו-RELEASE_MANAGER) — אחרת שני המודולים החדשים (אינטליגנציה, איכות גרסה) לא יופיעו בסיידבר גם למנהלים.

**⚠ שינוי שובר תאימות — הוסרה סנכרון-Excel לרשימת CR של QC:**
`POST /qc-releases/sync-excel` ו-`/qc-releases/sync-excel-path` הוסרו לחלוטין. רשימת גרסאות QC מסונכרנת כעת **אך ורק מ-Oracle** (`ORACLE_ENABLED=true` נדרש). אם שרת הייצור הזה הסתמך על סנכרון Excel-בלבד (ללא Oracle) לרשימת ה-QC releases — יכולת זו נעלמת בשדרוג הזה. זה נפרד מ-`QC_RELEASES_FILE`/`EXCEL_FILE_PATH` (סנכרון CR_LIST לגרסה), שלא השתנה.

**מה חדש ב-2.7.7:**

*Release Intelligence Center (מודול חדש):* 12 מסכי אנליטיקה חדשים תחת "🧠 אינטליגנציה" — סקירה כללית, ניהול QA יומי, בריאות CR, כיסוי ומוכנות, באגים, ניתוח Reopen, התקדמות סבבים, ציר זמן ופעילויות, קיבולת, תחזית ומעקב, התראות ותובנות (כולל ניהול "סיכוני גרסה" עם סטטוס פתוח/מטופל/סגור), ומסך Go/No-Go (יומן החלטות מדורג QA Manager ← Release Manager ← Management — ייעוצי בלבד, ללא השפעה על מצב הגרסה). שכבת נתונים לא-פולשנית מעל הנתונים הקיימים.

*Quality Hub — מרכז איכות גרסה (מודול חדש):* מודול נפרד ("🏆 איכות גרסה") לציון איכות רב-ממדי לכל גרסה, מיובא מקבצי Excel חיצוניים (הציונים מחושבים מחוץ למערכת). 6 מסכים: סקירה כללית, מטריצת KPI (כולל הערת "אחריות/שיפורים נדרשים/מאפייני הבעיות" הניתנת לעריכה ידנית לכל גרסה+KPI), השוואת גרסאות, ציר זמן איכות, הגדרות KPI, ותקלות ייצור פתוחות (KPI חדש הנשלף ישירות מ-Oracle). ייבוא קבצים דרך AdminPanel → איכות גרסה. **הטבלאות ריקות בהתקנה חדשה** — יש לייבא KPI Definitions ו-KPI Scores דרך ה-Excel לפני שהמודול מציג נתונים.

*חופשות — טווח תאריכים מטופל כיחידה אחת:* בקשת חופשה לטווח (למשל שבוע שלם) מוצגת כעת כרשומה אחת ("19.07 – 23.07 (5 ימים)") במקום שורה נפרדת לכל יום, ומאושרת/נדחית בפעולת מנהל אחת שחלה על כל הטווח. אחסון הנתונים בפועל נשאר יום-ליום (עמודת `groupId` משותפת) — כך שמנוע השיבוץ הקיים ממשיך לעבוד ללא שינוי.

*לוח באגי QC — הרחבה:* פילוחים חדשים "Reopen לפי CR" ו"קריטי לפי CR", ושדה Severity לכל תקלה. תוקן: הבחירה הידנית של גרסה בלוח כבר לא נתקעת מפעם קודמת (localStorage).

*סנכרון CR-ים לגרסה — שינוי כלל זכאות:* כעת מספיק מאמץ QA (מעל 0.3 ימים) על CR כדי שייכלל בשיוך לגרסה ובשיבוץ — אין יותר דרישה למעורבות צוות פיתוח נוסף. **שימו לב:** CR-ים ש-QA-בלבד עובד עליהם ייכנסו כעת לתכולה — לפני כן לא נכללו. בנוסף: סנכרון אוטומטי מול CR_LIST בכל טעינת מסך השיבוץ (לא רק ידני), אפשרות לסמן CR "לא לכלול" מהתצוגה המקדימה, וכפתור "לחץ לפרטי שינוי" שמסביר תגיות 🟢חדש/⚠הוסר.

*Runbook — עריכת שלבים (תכונה שהייתה חסרה):* ניתן כעת לערוך את שלבי תבנית Runbook (הוספה/מחיקה/שינוי) ולשמור כתבנית קבועה.

*QA — תכנון ושיבוץ:* השבתת משימה/שינוי מאמץ ידני מפעילים כעת חישוב-מחדש מדורג של הלוח כולו (במקום להשאיר חור ריק). תכונה חדשה: החלפת בודק למשימה קיימת ללא מחיקה/יצירה מחדש. הרשאת QaAdminGuard הורחבה: מוביל צוות QA מקבל גישה מלאה גם אם תפקידו הבסיסי אינו TEAM_LEAD.

*ממשק וניווט:* סיידבר עוצב מחדש (4 מודולים עם מתגי גישה נפרדים). ConfirmDialog תומך בפעולת אישור אסינכרונית. InviteDialog: "בחר הכל". DatePicker: כפתור ניקוי טווח. גופנים הוגדלו נוסף ~20%. ניקוי HTML/ישויות משדות טקסט ממקור QC בכל מסכי התיאורים.

*שונות ותיקונים:* HomeDashboard עוקב אחרי הגרסה הנבחרת בסיידבר (לא תמיד הדחופה ביותר). תוקן VersionWizard (אימות שעת ליל ההטמעה). תוקן TaskDetailPanel (שינוי "עובד אחראי" עדכן רק תצוגה, לא `assignedUserId` בפועל — השפיע על התראות/"המשימות שלי"). הוגן: לא ניתן עוד ליצור Task ללא שיוך לגרסה.

> **שדרוג בטוח מבחינת נתונים:** הייבוא הוא upsert-בלבד — לא מוחק שום דבר. משתמשים/צוותים/הרשאות/סקילים קיימים בשרת היעד נשמרים ורק מתעדכנים/מתווספים. ה-migrations החדשות תוספתיות בלבד ולא נוגעות בנתונים קיימים. **חריגים:** שני האזהרות בסעיף זה (הרשאות מודולים חדשים + הסרת סנכרון-Excel ל-QC).
>
> **בדיקה לאחר שדרוג:** ודא שההרשאות למודולי אינטליגנציה/איכות-גרסה הוענקו (ראו למעלה); שסנכרון QC עדיין עובד (דרך Oracle); שמסך "שיבוץ ותוכנית עבודה" (QA) עולה תקין; ושבקשת חופשה לטווח מוצגת/מאושרת כיחידה אחת.

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
  "version": "2.7.7",
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
✅ ADMIN/RELEASE_MANAGER roles have screen:release-intelligence + screen:quality-hub permission (new in 2.7.7 — NOT auto-granted on upgrade)
✅ QC release-list sync works via Oracle (Excel-only sync path was removed in 2.7.7)
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
cat /opt/deploycenter/backup-pre-2.7.7-DATE.sql | docker exec -i dc-postgres \
  psql -U dcuser deploycenter

# 3. החזר images ישנים (אם שמרת)
docker load -i deploycenter-docker-v2.7.6.tar

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
