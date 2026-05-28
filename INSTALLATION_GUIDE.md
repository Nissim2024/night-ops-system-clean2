# Night-Ops System — מדריך התקנה

> גרסה: 1.1 | תאריך: מאי 2026

---

## תוכן עניינים

1. [דרישות שרת — חומרה ותוכנה](#1-דרישות-שרת)
2. [חוקי Firewall נדרשים](#2-חוקי-firewall)
3. [התקנת הפרויקט](#3-התקנת-הפרויקט)
4. [הגדרת משתני סביבה](#4-הגדרת-משתני-סביבה)
5. [הגדרת בסיס הנתונים](#5-הגדרת-בסיס-הנתונים)
6. [התקנת תלויות](#6-התקנת-תלויות)
7. [הפעלת המערכת — פיתוח](#7-הפעלה-בפיתוח)
8. [פריסה לייצור](#8-פריסה-לייצור)
9. [חיבור למערכת QC (Oracle)](#9-חיבור-ל-qc)
10. [אתחול ראשוני](#10-אתחול-ראשוני)
11. [פתרון בעיות נפוצות](#11-פתרון-בעיות)

---

## 1. דרישות שרת

### 1.1 ארכיטקטורת הפריסה

ניתן להתקין בשתי צורות:

```
אפשרות א — שרת יחיד (מומלץ לארגון בינוני):
┌─────────────────────────────────┐
│         שרת אפליקציה            │
│  Node.js (Backend + Frontend)   │
│  PostgreSQL (DB)                │
│  nginx (Reverse Proxy)          │
└─────────────────────────────────┘

אפשרות ב — שרתים נפרדים (ייצור גדול):
┌─────────────────┐    ┌─────────────────┐
│  שרת אפליקציה  │    │    שרת DB       │
│  Node.js / nginx│◄──►│  PostgreSQL 15  │
└─────────────────┘    └─────────────────┘
```

---

### 1.2 דרישות חומרה

#### שרת אפליקציה (מינימום)

| משאב | מינימום | מומלץ לייצור |
|------|---------|--------------|
| **CPU** | 2 ליבות | 4 ליבות |
| **RAM** | 4 GB | 8 GB |
| **אחסון** | 20 GB SSD | 50 GB SSD |
| **רשת** | 100 Mbps | 1 Gbps |
| **מערכת הפעלה** | Windows Server 2019 / Ubuntu 22.04 | Ubuntu 22.04 LTS |

> **הסבר:** Node.js קל יחסית. הייצור במהלך ליל ההטמעה כולל עשרות משתמשים בו-זמנית עם WebSocket — ה-RAM הוא המשאב הקריטי.

#### שרת בסיס נתונים (אם נפרד)

| משאב | מינימום | מומלץ |
|------|---------|-------|
| **CPU** | 2 ליבות | 4 ליבות |
| **RAM** | 4 GB | 8 GB |
| **אחסון** | 50 GB SSD | 200 GB SSD |

> לאחר שנה של שימוש עם ~20 גרסאות, בסיס הנתונים ינוע סביב 2-5 GB. SSD מומלץ לביצועים.

---

### 1.3 תוכנה נדרשת

| רכיב | גרסה מינימלית | הורדה |
|------|---------------|-------|
| **Node.js** | 20.x LTS | nodejs.org |
| **npm** | 9.x | מגיע עם Node.js |
| **PostgreSQL** | 15.x | postgresql.org |
| **Git** | 2.x | git-scm.com |
| **nginx** | 1.24+ (ייצור) | nginx.org |
| **PM2** | 5.x (ייצור) | `npm i -g pm2` |

### 1.4 תוכנה אופציונלית (לחיבור QC)

| רכיב | שימוש |
|------|-------|
| **Oracle Instant Client** | חיבור לבסיס נתוני QC |
| **oracledb (npm)** | Node.js driver לOracle |

---

## 2. חוקי Firewall

### 2.1 טבלת חוקים נדרשים

#### כניסה לשרת האפליקציה (Inbound)

| פורט | פרוטוקול | מקור | תיאור |
|------|----------|------|-------|
| **443** | TCP | כל המשתמשים (רשת פנימית) | HTTPS — גישת משתמשים |
| **80** | TCP | כל המשתמשים | HTTP → מנותב אוטומטית ל-443 |
| **22** | TCP | צוות IT בלבד | SSH לניהול השרת |

> **אם אין nginx (פיתוח/בדיקות בלבד):**

| פורט | פרוטוקול | מקור | תיאור |
|------|----------|------|-------|
| **3000** | TCP | כל המשתמשים | Backend API + WebSocket |
| **3001** | TCP | כל המשתמשים | Frontend React |

#### יציאה משרת האפליקציה (Outbound)

| פורט | פרוטוקול | יעד | תיאור |
|------|----------|-----|-------|
| **5432** | TCP | שרת PostgreSQL | בסיס נתונים פנימי |
| **1521** | TCP | שרת Oracle QC | חיבור ל-QC (אם מופעל) |
| **587** / **465** | TCP | שרת SMTP | שליחת מיילים (אם מוגדר) |

#### בין שרת האפליקציה לשרת DB (אם נפרדים)

| פורט | פרוטוקול | כיוון | תיאור |
|------|----------|-------|-------|
| **5432** | TCP | App → DB | PostgreSQL |

---

### 2.2 WebSocket — חוקים מיוחדים

WebSocket (Socket.IO) פועל על **אותו פורט** כמו ה-API (3000 / 443). דרישות מיוחדות:

- **Firewall / Load Balancer** חייב לאפשר **Upgrade HTTP → WebSocket**
- אם יש **nginx** — חובה להוסיף headers:
  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```
- אם יש **timeout** ב-FW — הגדר לפחות **60 שניות** (SocketIO שולח ping כל 25 שניות)

---

### 2.3 סיכום חוקים — ליישום בצוות IT

```
לפתיחה בשרת האפליקציה:
  IN  TCP 443  ← LAN_USERS
  IN  TCP 80   ← LAN_USERS
  IN  TCP 22   ← IT_MANAGEMENT_SUBNET

  OUT TCP 5432 → DB_SERVER_IP
  OUT TCP 1521 → QC_ORACLE_SERVER_IP    (אם נדרש QC)
  OUT TCP 587  → SMTP_SERVER_IP         (אם נדרש מייל)

לפתיחה בשרת PostgreSQL:
  IN  TCP 5432 ← APP_SERVER_IP
```

---

## 3. התקנת הפרויקט

### שכפול הקוד

```bash
git clone <repository-url> night-ops-system
cd night-ops-system
```

### מבנה התיקיות

```
night-ops-system/
├── backend/               # שרת NestJS (פורט 3000)
│   ├── src/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── .env               # יש ליצור — ראה סעיף 4
└── frontend/              # ממשק React (פורט 3001)
    ├── src/
    ├── public/
    └── package.json
```

---

## 4. הגדרת משתני סביבה

### קובץ `backend/.env`

```env
# ── בסיס נתונים ──────────────────────────────────────────
DATABASE_URL="postgresql://nightops_user:PASSWORD@localhost:5432/nightops_db"

# ── אימות ────────────────────────────────────────────────
JWT_SECRET="מחרוזת-אקראית-של-לפחות-32-תווים"

# ── שרת ──────────────────────────────────────────────────
PORT=3000
FRONTEND_URL=https://your-domain.com

# ── QC Integration (Oracle) ───────────────────────────────
# QC_ENABLED=true
# ORACLE_USER=qc_readonly_user
# ORACLE_PASS=qc_password
# ORACLE_CONN_STR=QC_SERVER_HOST:1521/QC_SERVICE_NAME

# ── אימייל ───────────────────────────────────────────────
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_USER=noreply@company.com
# SMTP_PASS=smtp_password
```

### יצירת JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 5. הגדרת בסיס הנתונים

```sql
-- התחבר כ-superuser
psql -U postgres

CREATE USER nightops_user WITH PASSWORD 'strong_password_here';
CREATE DATABASE nightops_db OWNER nightops_user;
GRANT ALL PRIVILEGES ON DATABASE nightops_db TO nightops_user;
\q
```

### עדכון DATABASE_URL ב-.env

```env
DATABASE_URL="postgresql://nightops_user:strong_password_here@localhost:5432/nightops_db"
```

---

## 6. התקנת תלויות

```bash
# באקאנד
cd backend
npm install

# פרונטאנד
cd ../frontend
npm install

# יצירת סכמת בסיס הנתונים
cd ../backend
npx prisma db push
npx prisma generate
```

---

## 7. הפעלה בפיתוח

```bash
# טרמינל 1 — באקאנד
cd backend && npm run start:dev

# טרמינל 2 — פרונטאנד
cd frontend && npm start
```

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

---

## 8. פריסה לייצור

### בניית הקוד

```bash
# פרונטאנד
cd frontend && npm run build

# באקאנד
cd ../backend && npm run build
```

### הגדרת nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/nightops.crt;
    ssl_certificate_key /etc/ssl/private/nightops.key;

    # Frontend (קבצים סטטיים)
    location / {
        root /path/to/frontend/build;
        try_files $uri $uri/ /index.html;
    }

    # Backend API + WebSocket
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

### הפעלה עם PM2

```bash
npm install -g pm2

cd backend
pm2 start dist/main.js --name nightops-api \
  --env production \
  -- \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="..." \
  PORT=3000 \
  FRONTEND_URL="https://your-domain.com"

pm2 save && pm2 startup
```

---

## 9. חיבור ל-QC

### 9.1 רקע

מערכת QC (HP ALM / Micro Focus ALM) שומרת את נתוני הבדיקות בOracle DB. Night-Ops מתחבר ישירות לOracle לשליפת:
- **Test Coverage** — תכסית בדיקות לפי Release/Cycle
- **Defects** — רשימת תקלות פתוחות
- **CR Items** — רשימת CR-ים לשיוך במשימות

כרגע הנתונים הם **Mock** (נתוני דמה קשיחים). להפעלת חיבור אמיתי — בצע את השלבים הבאים.

---

### 9.2 דרישות Oracle

| דרישה | פרטים |
|-------|-------|
| **Oracle Instant Client** | גרסה 19c / 21c — מתאימה לגרסת שרת QC |
| **גישת רשת** | פורט 1521 (או הפורט המוגדר בשרת QC) פתוח |
| **משתמש DB** | משתמש Oracle עם הרשאות **SELECT בלבד** על הטבלאות הרלוונטיות |

#### הרשאות Oracle נדרשות (מינימום)

```sql
-- הרץ בשרת Oracle ע"י DBA:
GRANT SELECT ON schema_qc.test_coverage_view TO nightops_readonly;
GRANT SELECT ON schema_qc.defects_view        TO nightops_readonly;
GRANT SELECT ON schema_qc.cr_table            TO nightops_readonly;
```

> שמות הטבלאות/view תלויים בגרסת ALM ובהגדרות הספציפיות שלכם. בקש מצוות QC את שמות הטבלאות הנכונות.

---

### 9.3 התקנת Oracle Instant Client

#### Windows

1. הורד מ-oracle.com → "Instant Client Downloads for Windows"
2. בחר גרסה המתאימה לשרת QC
3. חלץ לתיקייה, לדוגמה: `C:\oracle\instantclient_21_12`
4. הוסף לPath:
   ```powershell
   [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\oracle\instantclient_21_12", "Machine")
   ```

#### Linux (Ubuntu)

```bash
# הורד RPM והמר ל-DEB, או השתמש ב-apt:
apt-get install libaio1
# חלץ Instant Client לתיקייה
ldconfig /opt/oracle/instantclient_21_12
```

---

### 9.4 התקנת npm package

```bash
cd backend
npm install oracledb
```

> **שים לב:** `oracledb` דורש את Oracle Instant Client להיות מותקן על השרת.

---

### 9.5 הגדרת משתני סביבה לQC

ב-`backend/.env`:

```env
QC_ENABLED=true
ORACLE_USER=nightops_readonly
ORACLE_PASS=your_oracle_password
ORACLE_CONN_STR=QC_SERVER_IP:1521/QC_SERVICE_NAME
```

#### דוגמה ל-Connection String

```env
# פורמט: HOST:PORT/SERVICE_NAME
ORACLE_CONN_STR=10.0.1.50:1521/QCPROD
```

---

### 9.6 כתיבת הקוד (TODO נדרש)

קובץ `backend/src/qc/qc.service.ts` מכיל פונקציות mock עם `// TODO` מסומנות. יש להשלים:

```typescript
import * as oracledb from 'oracledb';

// הוסף בתוך QcService:
private async getConnection() {
  return oracledb.getConnection({
    user:           process.env.ORACLE_USER,
    password:       process.env.ORACLE_PASS,
    connectString:  process.env.ORACLE_CONN_STR,
  });
}

async getTestCoverage(releaseId: string, cycleId?: string): Promise<TestCoverageDto[]> {
  if (!QC_ENABLED) return MOCK_COVERAGE;

  const conn = await this.getConnection();
  try {
    const result = await conn.execute(
      `SELECT plan_id, lab_id, responsible, passed, failed, not_completed, blocked, not_run, subject, title
       FROM schema_qc.test_coverage_view
       WHERE release_id = :releaseId
       ${cycleId ? 'AND cycle_id = :cycleId' : ''}
       ORDER BY plan_id`,
      cycleId ? { releaseId, cycleId } : { releaseId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows as any[]).map(r => ({
      planId:       String(r.PLAN_ID),
      labId:        String(r.LAB_ID),
      responsible:  r.RESPONSIBLE,
      passed:       r.PASSED,
      failed:       r.FAILED,
      notCompleted: r.NOT_COMPLETED,
      blocked:      r.BLOCKED,
      notRun:       r.NOT_RUN,
      subject:      r.SUBJECT || '',
      title:        r.TITLE,
      release:      releaseId,
      cycle:        cycleId || '',
      total:        r.PASSED + r.FAILED + r.NOT_COMPLETED + r.BLOCKED + r.NOT_RUN,
      planned:      r.PASSED + r.FAILED + r.NOT_COMPLETED + r.BLOCKED + r.NOT_RUN,
    }));
  } finally {
    await conn.close();
  }
}
```

> **שמות העמודות** (`PASSED`, `FAILED`, וכו') תלויים בstructure הספציפי של ALM שלכם. בקש מצוות QC את הschema.

---

### 9.7 בדיקת חיבור Oracle

```bash
cd backend
npx ts-node -e "
const oracledb = require('oracledb');
oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASS,
  connectString: process.env.ORACLE_CONN_STR,
}).then(c => { console.log('Oracle OK'); c.close(); })
  .catch(e => console.error('Oracle FAILED:', e.message));
"
```

---

## 10. אתחול ראשוני

### יצירת משתמש ADMIN ראשון

```bash
cd backend
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
async function main() {
  const hash = await bcrypt.hash('Admin1234!', 10);
  await prisma.user.create({
    data: { email: 'admin@company.com', password: hash, fullName: 'מנהל מערכת', role: 'ADMIN', isActive: true }
  });
  console.log('Admin created');
  await prisma.\$disconnect();
}
main().catch(console.error);
"
```

### כניסה ראשונה

- כתובת: `http://your-server/` (או `http://localhost:3001` בפיתוח)
- מייל: `admin@company.com`
- סיסמה: `Admin1234!`

---

## 11. פתרון בעיות

### פורט תפוס (EADDRINUSE)

```powershell
# Windows
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```

### שגיאת חיבור PostgreSQL

```bash
pg_isready -h localhost -p 5432
psql "$DATABASE_URL" -c "SELECT NOW();"
```

### שגיאת Prisma: טבלה לא קיימת

```bash
cd backend
npx prisma db push
npx prisma generate
```

### שגיאת CORS

וודא שב-`main.ts` כתובת הפרונטאנד ב-CORS מתאימה לפועל, וש-`FRONTEND_URL` ב-.env נכון.

### WebSocket לא מתחבר

1. בדוק שnginx מגדיר `Upgrade` headers
2. וודא שה-FW timeout לפחות 60 שניות
3. בדוק Console בדפדפן לשגיאות

### Oracle — שגיאת `NJS-045: cannot load the oracledb add-on`

```bash
# Linux — בדוק שOracle Instant Client נמצא ב-LD_LIBRARY_PATH
export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_12:$LD_LIBRARY_PATH

# Windows — בדוק שהתיקייה ב-PATH
[System.Environment]::GetEnvironmentVariable("PATH", "Machine") | Select-String "oracle"
```

---

*Night-Ops System — מדריך התקנה v1.1, מאי 2026*
