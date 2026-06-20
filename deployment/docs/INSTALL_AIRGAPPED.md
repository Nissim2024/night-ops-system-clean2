# DeployCenter — מדריך התקנה מלא (שרת ללא אינטרנט)

---

## דרישות מוקדמות

### מה IT צריכים להתקין על השרת לפני שמתחילים

| תוכנה | גרסה |
|--------|-------|
| Docker Engine + Compose plugin | 26.x |
| PostgreSQL | 16 |
| Redis | 7.x |
| Nginx | 1.24+ |
| Git | 2.x |

### מה אתה צריך על **המחשב שלך** (עם אינטרנט)

- Docker Desktop מותקן ופועל
- גישה ל-Git/GitHub
- גישת SSH לשרת

---

## שלב 1 — משיכת הקוד מ-GitHub

**על המחשב שלך:**

```bash
git clone https://github.com/Nissim2024/night-ops-system-clean2.git
cd night-ops-system-clean2
git checkout prod
```

> כל קבצי ה-deployment נמצאים בתיקייה: `deployment/`

---

## שלב 2 — בניית חבילת ה-deploy

**על המחשב שלך** (עם Docker פועל):

```bash
cd deployment
make prepare VERSION=v2.2.0
```

הסקריפט ישאל אותך:

```
מה כתובת השרת שהמשתמשים יגשו אליו?
SERVER_URL: http://192.168.1.50
```

> הכנס את כתובת ה-IP הפנימית של השרת (לדוגמה: `http://192.168.1.50`)

**הסקריפט עושה אוטומטית:**
1. בונה Docker image של ה-Backend
2. בונה Docker image של ה-Frontend (עם כתובת השרת שהכנסת)
3. שומר את כל ה-images לקובץ אחד
4. מכין חבילת deploy מסודרת

**תוצר סופי:**
```
night-ops-system-clean2/
└── dist/
    └── DeployCenter-airgapped-v2.2.0.tar.gz   ← החבילה להעברה לשרת
```

> **זמן משוער:** 5–10 דקות (תלוי במהירות האינטרנט)

---

## שלב 3 — העברת החבילה לשרת

**אפשרות א — דרך SCP (רשת פנימית):**
```bash
scp dist/DeployCenter-airgapped-v2.2.0.tar.gz USER@SERVER_IP:/tmp/
```

**אפשרות ב — דרך USB/תיקייה משותפת:**
- העתק את הקובץ `DeployCenter-airgapped-v2.2.0.tar.gz` לאמצעי האחסון
- הכנס לשרת והעתק לתיקייה `/tmp/`

---

## שלב 4 — הכנת מסד הנתונים (PostgreSQL)

**התחבר לשרת ב-SSH:**
```bash
ssh USER@SERVER_IP
```

**צור DB ו-user ל-DeployCenter:**
```bash
sudo -u postgres psql
```

```sql
CREATE USER DeployCenter_user WITH PASSWORD 'בחר_סיסמה_חזקה';
CREATE DATABASE DeployCenter_prod OWNER DeployCenter_user;
GRANT ALL PRIVILEGES ON DATABASE DeployCenter_prod TO DeployCenter_user;
\q
```

> **שמור את הסיסמה** — תצטרך אותה בשלב 6

---

## שלב 5 — חילוץ החבילה וטעינת Docker images

**על השרת:**

```bash
# חלץ את החבילה
cd /tmp
tar -xzf DeployCenter-airgapped-v2.2.0.tar.gz

# טען את ה-Docker images (ייקח 2–3 דקות)
docker load -i DeployCenter-airgapped-v2.2.0/DeployCenter-images-v2.2.0.tar
```

**אמת שה-images נטענו:**
```bash
docker images | grep DeployCenter
```

צפוי לראות:
```
DeployCenter-backend    v2.2.0-blue    ...
DeployCenter-backend    latest-blue    ...
DeployCenter-frontend   v2.2.0         ...
DeployCenter-frontend   latest         ...
```

---

## שלב 6 — הגדרת קובץ הסביבה

**הרץ את סקריפט ההתקנה:**
```bash
cd /tmp/DeployCenter-airgapped-v2.2.0/deployment
bash scripts/initial_deploy_airgapped.sh v2.2.0 /tmp/DeployCenter-airgapped-v2.2.0
```

הסקריפט ייצור שני קבצים ויבקש ממך לערוך אותם:
- `/opt/DeployCenter/blue/.env.blue`
- `/opt/DeployCenter/green/.env.green`

**ערוך את הקובץ:**
```bash
nano /opt/DeployCenter/blue/.env.blue
```

**מלא את הערכים הבאים:**

```env
SLOT=blue
APP_VERSION=v2.2.0

# ← הכנס את ה-IP הפנימי של השרת וסיסמת ה-DB שיצרת בשלב 4
DATABASE_URL=postgresql://DeployCenter_user:סיסמה_מ_שלב_4@localhost:5432/DeployCenter_prod

# ← צור מחרוזת רנדומלית: pwgen -s 48 1
JWT_SECRET=מחרוזת_רנדומלית_ארוכה_לפחות_32_תווים

# ← כתובת הגישה של המשתמשים (אותו דבר שהכנסת בשלב 2)
CORS_ORIGINS=http://192.168.1.50

# השאר ריק (אפשר להגדיר מאוחר יותר)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

# LDAP — שנה ל-true רק אם נדרש
LDAP_ENABLED=false
LDAP_URL=
LDAP_BASE_DN=
LDAP_BIND_DN=
LDAP_BIND_PASSWORD=
```

**חזור על אותו הדבר לקובץ green:**
```bash
nano /opt/DeployCenter/green/.env.green
```
> שנה רק שורה אחת: `SLOT=green`

**לחץ Enter כשמסיים:**

הסקריפט ימשיך ויבצע אוטומטית:
- בדיקת חיבור ל-PostgreSQL
- בדיקת חיבור ל-Redis
- יצירת Docker network
- הרצת DB migrations
- הפעלת containers
- הגדרת Nginx

---

## שלב 7 — יצירת JWT Secret (אם אין)

```bash
# צור מחרוזת רנדומלית חזקה
openssl rand -base64 48
```

> העתק את הפלט לתוך `JWT_SECRET` בקובץ ה-.env

---

## שלב 8 — אימות ההתקנה

**בדוק שה-containers פועלים:**
```bash
docker ps --filter "name=DeployCenter"
```

צפוי לראות:
```
DeployCenter-backend-blue    Up X minutes
DeployCenter-frontend-blue   Up X minutes
```

**בדוק בריאות המערכת:**
```bash
cd /tmp/DeployCenter-airgapped-v2.2.0/deployment
make health SLOT=blue
```

**בדוק שהאפליקציה נגישה:**
```bash
curl -s http://localhost/health
```

צפוי: `{"status":"ok","db":"ok"}`

**גישה דרך דפדפן:**
```
http://SERVER_IP
```

---

## שלב 9 — משתמש ראשון

**מצב ברירת מחדל — ניתן להתחבר עם:**

| משתמש | סיסמה | תפקיד |
|--------|-------|-------|
| `nissim@test.com` | `123456` | ADMIN |
| `hay@dev.com` | `123456` | RELEASE_MANAGER |

> **חשוב:** שנה סיסמאות מיד לאחר הכניסה הראשונה דרך Admin Panel

---

## מבנה הקבצים על השרת (לאחר התקנה)

```
/opt/DeployCenter/
├── app/
│   └── deployment/         ← סקריפטים + nginx config
├── blue/
│   └── .env.blue           ← הגדרות Blue slot
├── green/
│   └── .env.green          ← הגדרות Green slot
├── state/
│   └── active_slot         ← "blue" (ה-slot הפעיל)
├── backups/                ← גיבויי DB
└── logs/                   ← לוגי deploy
```

---

## פקודות שימושיות

```bash
# מצב המערכת
make -C /opt/DeployCenter/app/deployment status

# לוגים של ה-backend
docker logs DeployCenter-backend-blue -f

# גיבוי DB
make -C /opt/DeployCenter/app/deployment backup VERSION=v2.2.0

# הפסקה והפעלה מחדש
docker restart DeployCenter-backend-blue DeployCenter-frontend-blue
```

---

## תקלות נפוצות

### "Port already in use"
```bash
# מי תופס את הפורט?
sudo lsof -i :80
sudo lsof -i :3010
```

### "Cannot connect to PostgreSQL"
```bash
# בדוק שה-DB פועל
sudo systemctl status postgresql
# בדוק חיבור
psql postgresql://DeployCenter_user:סיסמה@localhost:5432/DeployCenter_prod -c "SELECT 1"
```

### "Redis connection refused"
```bash
sudo systemctl status redis
redis-cli ping
```

### Container לא עולה
```bash
docker logs DeployCenter-backend-blue --tail 50
```

---

## קישורים

- **GitHub Repo:** https://github.com/Nissim2024/night-ops-system-clean2
- **Branch:** `prod`
- **תיקיית Deploy:** `deployment/`
- **Makefile:** `deployment/Makefile`
