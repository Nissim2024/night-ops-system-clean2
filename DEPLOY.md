# הוראות התקנה — DeployCenter (Production)

## סביבה
| רכיב       | פורט   | הערות                       |
|------------|--------|-----------------------------|
| Backend    | 3010   | NestJS — Docker container   |
| Frontend   | 3011   | React + nginx — Docker      |
| PostgreSQL | 5434   | Docker                      |
| Redis      | 6379   | Docker                      |

---

## דרישות מוקדמות בשרת
- **Docker** + **Docker Compose v2** (`docker compose version`)
- פורטים 3010, 3011, 5434, 6379 פתוחים ב-Firewall
- אין צורך ב-Node.js בשרת — הכל רץ בתוך Docker

---

## שלב 1 — העברת הקבצים לשרת

**אפשרות א' — ZIP (הפשוטה ביותר):**
```powershell
# על המחשב המפתח — צור ZIP (ללא node_modules)
Compress-Archive -Path night-ops-system-clean2\* `
  -CompressionLevel Optimal `
  -DestinationPath nightops-prod.zip `
  -Force
```
העבר את `nightops-prod.zip` לשרת (SCP / USB / Share) ופרוס:
```bash
unzip nightops-prod.zip -d night-ops-system-clean2
cd night-ops-system-clean2
```

**אפשרות ב' — Git:**
```bash
git clone <REPO_URL> night-ops-system-clean2
cd night-ops-system-clean2
```

---

## שלב 2 — קינפוג `.env.prod`
ערוך את `backend/.env.prod` בשרת:
```env
DATABASE_URL="postgresql://nightops_user:nightops_pass@postgres-prod:5432/nightops_prod"
JWT_SECRET="צור_עם: openssl rand -hex 32"
PORT=3010
NODE_ENV=prod
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_EMAIL="mailto:admin@yourcompany.com"
ORACLE_ENABLED=false
```

> **שים לב:** ב-DATABASE_URL השתמש ב-`postgres-prod` (שם הקונטיינר) — לא `localhost`

---

## שלב 3 — בניית ה-Images
```bash
cd night-ops-system-clean2

# בנה את כל ה-images
docker compose --profile prod build
```

אם ה-API URL שונה מ-localhost (שרת חיצוני):
```bash
docker compose --profile prod build \
  --build-arg REACT_APP_API_URL=http://SERVER_IP:3010
```

---

## שלב 4 — הפעלת כל המערכת
```bash
docker compose --profile prod up -d
```

בדוק שכל הקונטיינרים עלו:
```bash
docker ps
```
צפוי:
```
nightops-postgres-prod    ✅
nightops-redis            ✅
nightops-backend-prod     ✅
nightops-frontend-prod    ✅
```

---

## שלב 5 — מיגרציית בסיס הנתונים
> **חשוב:** פקודה זו **לא מוחקת** נתונים — רק מוסיפה/מעדכנת טבלאות.
```bash
docker exec nightops-backend-prod \
  npx prisma db push --skip-generate
```

---

## שלב 6 — בדיקת תקינות
| כתובת                        | צפוי              |
|------------------------------|-------------------|
| `http://SERVER:3011`         | מסך Login         |
| `http://SERVER:3010/health`  | `{"status":"ok"}` |

---

## עדכון גרסה עתידית (Upgrade)
```bash
# 1. משוך קבצים חדשים (ZIP או git pull)

# 2. בנה images חדשים
docker compose --profile prod build

# 3. הפעל מחדש (downtime של שניות)
docker compose --profile prod up -d

# 4. עדכן DB אם יש שינויים בסכמה
docker exec nightops-backend-prod npx prisma db push --skip-generate
```

## לוגים ופתרון בעיות
```bash
# צפה בלוגים
docker logs nightops-backend-prod -f
docker logs nightops-frontend-prod -f

# הפעל מחדש קונטיינר בודד
docker restart nightops-backend-prod

# עצור הכל
docker compose --profile prod down
```

---

---

## קינפוג אינטגרציות

### 1. AD / LDAP (התחברות Active Directory)
מוגדר **ממסך הניהול** (Admin Panel → לשונית LDAP) — ללא עריכת קבצים.

| פרמטר              | תיאור                                                      | דוגמה                              |
|--------------------|------------------------------------------------------------|------------------------------------|
| `LDAP_ENABLED`     | הפעל חיבור LDAP                                           | `true`                             |
| `LDAP_URL`         | כתובת שרת AD (LDAP/LDAPS)                                 | `ldap://dc.company.local:389`      |
| `LDAP_BASE_DN`     | נקודת חיפוש משתמשים                                       | `DC=company,DC=local`              |
| `LDAP_BIND_DN`     | חשבון שירות לחיבור ל-AD                                  | `CN=svc-app,OU=Svc,DC=company,DC=local` |
| `LDAP_BIND_PASSWORD` | סיסמת חשבון השירות                                      | `סיסמה`                           |
| `LDAP_USER_FILTER` | פילטר חיפוש משתמש לפי username                            | `(sAMAccountName={{username}})`    |
| `LDAP_NAME_ATTR`   | שדה שם מלא ב-AD                                           | `displayName`                      |
| `LDAP_EMAIL_ATTR`  | שדה אימייל ב-AD                                           | `mail`                             |

**בדיקת חיבור:** Admin Panel → LDAP → כפתור "בדוק חיבור"

---

### 2. דואר אלקטרוני (SMTP)
מוגדר **ממסך הניהול** (Admin Panel → פרמטרי מערכת).

| פרמטר                      | תיאור                              | דוגמה                        |
|----------------------------|------------------------------------|------------------------------|
| `EMAIL_ENABLED`            | הפעל שליחת מיילים                  | `true`                       |
| `EMAIL_HOST`               | שרת SMTP                           | `smtp.company.local`         |
| `EMAIL_PORT`               | פורט SMTP                          | `587` (TLS) / `465` (SSL)    |
| `EMAIL_SECURE`             | השתמש ב-SSL/TLS                    | `true` / `false`             |
| `EMAIL_USER`               | שם משתמש SMTP                      | `noreply@company.com`        |
| `EMAIL_PASSWORD`           | סיסמת SMTP                         | `סיסמה`                      |
| `EMAIL_FROM`               | כתובת שולח                         | `"DeployCenter" <noreply@company.com>` |
| `EMAIL_DISTRIBUTION_LIST`  | רשימת תפוצה (פסיק מפריד)          | `admin@company.com,ops@company.com` |

**הערה:** כשמוגדר Exchange פנימי ללא auth, השאר `EMAIL_USER` ו-`EMAIL_PASSWORD` ריקים.

---

### 3. QC (מערכת בדיקות)
כרגע המערכת פועלת עם **נתוני Mock**. לחיבור אמיתי — יש לפנות לצוות הפיתוח.

| משתנה ב-.env  | תיאור                   | ברירת מחדל |
|---------------|-------------------------|------------|
| `QC_ENABLED`  | הפעל חיבור QC אמיתי     | `false`    |

---

### 4. Oracle DB (סנכרון QC Releases)
לסנכרון שחרורי QC אוטומטי ממסד Oracle.
מוגדר **בקובץ** `backend/.env`:

```env
ORACLE_ENABLED=true
ORACLE_USER=qc_reader
ORACLE_PASSWORD=סיסמה
ORACLE_CONNECT_STRING=hostname:1521/QCDB
```

**הערה:** נדרש `oracledb` native client מותקן בשרת. ראה: https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html

**בדיקה:** Admin Panel → QC Releases → "סנכרן"

---

### 5. קובץ CR (Excel)
נתיב לקובץ ה-Excel עם רשימת ה-CR. מוגדר ממסך הניהול:

| פרמטר           | תיאור                              | דוגמה                                |
|-----------------|------------------------------------|--------------------------------------|
| `EXCEL_FILE_PATH` | נתיב מלא לקובץ ה-CR ב-Excel      | `C:\CR_Files\cr_list.xlsx`           |

**הערה:** הנתיב הוא על השרת שבו הבאקאנד רץ. השתמש בנתיב UNC אם הקובץ נמצא ברשת.

---

### 6. Push Notifications (WebPush / VAPID)
מוגדר **בקובץ** `backend/.env`:

```env
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_EMAIL="mailto:admin@company.com"
```

**יצירת מפתחות חדשים:**
```bash
npx web-push generate-vapid-keys
```
העתק את הפלט לקובץ `.env`.

---

## סדר הגדרה מומלץ לאחר ההתקנה
1. ✅ כנס עם משתמש `admin` ברירת מחדל
2. ✅ Admin Panel → פרמטרי מערכת → הגדר `EXCEL_FILE_PATH`
3. ✅ Admin Panel → LDAP → הפעל והגדר חיבור AD → בדוק חיבור
4. ✅ Admin Panel → פרמטרי מערכת → הגדר Email SMTP → שלח מייל בדיקה
5. ✅ Admin Panel → QC Releases → בדוק סנכרון (אם Oracle פעיל)
6. ✅ Admin Panel → צוותים → הגדר אילו צוותים פטורים מהגשת תוכנית

---

## קבצים שצריך לשמור בצד (לא להחליף בעדכון)
- `backend/.env` — קינפוג סביבה עם סיסמאות אמיתיות
- `backend/prisma/schema.prisma` — רק אם שונה ב-code

---

_הופק מ-build מוצלח ב-10.06.2026_
