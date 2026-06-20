# DeployCenter — Production Deployment Guide

## ארכיטקטורה

```
Internet → Nginx (port 80)
              ├── /api/*      → Active Backend  (Blue:3010 | Green:3012)
              ├── /socket.io/ → Active Backend  (WebSocket)
              └── /*          → Active Frontend (Blue:3011 | Green:3013)

PostgreSQL (חיצוני) ←──── שני הslots מתחברים לאותו DB
Redis      (חיצוני) ←──── שני הslots מתחברים לאותו Redis
```

---

## התקנה ראשונית

```bash
# 1. הורד את הריפו
git clone https://github.com/Nissim2024/night-ops-system-clean2.git /opt/DeployCenter/app
cd /opt/DeployCenter/app

# 2. הרץ את האשף
make install VERSION=v2.2.0
```

האשף יבקש ממך למלא את קובצי ה-.env לפני שימשיך.

---

## שדרוג גרסה (Zero Downtime)

```bash
cd /opt/DeployCenter/app/deployment

# שלב A — Deploy גרסה חדשה ל-Green (Blue ממשיך לשרת!)
make deploy VERSION=v2.3.0

# שלב B — אחרי שאתה מרוצה מה-Green
make switch

# שלב C — אחרי grace period (אופציונלי — סגור Blue)
docker stop DeployCenter-backend-blue DeployCenter-frontend-blue
```

---

## מבנה קבצים בשרת

```
/opt/DeployCenter/
├── app/                    ← קוד המקור (git)
│   └── deployment/
│       ├── blue/
│       ├── green/
│       ├── scripts/
│       ├── nginx/
│       └── Makefile
├── blue/
│   └── .env.blue           ← secrets של Blue
├── green/
│   └── .env.green          ← secrets של Green
├── state/
│   └── active_slot         ← "blue" or "green"
├── backups/
│   ├── 20260614_120000_v2.2.0.sql.gz
│   └── manifest.log
└── logs/
    ├── deploy_v2.3.0_*.log
    ├── switch_*.log
    └── rollback_*.log
```

---

## DB Migration — כללים קריטיים

| מותר | אסור |
|------|------|
| `prisma migrate deploy` | `prisma db push` בפרודקשן |
| הוסף עמודות nullable | מחק עמודות ישירות |
| שנה שמות ב-2 שלבים | שנה type של עמודה קיימת |
| הוסף טבלאות | DROP TABLE ידני |

### הוספת שינוי סכמה (בפיתוח)

```bash
# ב-dev בלבד:
npx prisma migrate dev --name add_new_column

# commit את קובץ ה-migration ל-Git
git add prisma/migrations/
git commit -m "migration: add_new_column"
```

---

## Ports Summary

| Port | Service | Slot | Direction |
|------|---------|------|-----------|
| 80   | Nginx   | —    | Public inbound |
| 3010 | Backend | Blue | Internal only |
| 3011 | Frontend| Blue | Internal only |
| 3012 | Backend | Green| Internal only |
| 3013 | Frontend| Green| Internal only |

Nginx מאזין על **80 בלבד**. שאר הפורטים — `127.0.0.1` בלבד (לא חשופים מבחוץ).
