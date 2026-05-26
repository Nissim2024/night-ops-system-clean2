# DeployCenter — אשף התקנה

## דרישות מקדימות
- Ubuntu 20.04/22.04/24.04 **או** RHEL/Rocky/AlmaLinux 8/9
- גישת root / sudo
- חיבור אינטרנט (להורדת חבילות)

## הפעלה

```bash
# 1. העתק את תיקיית הפרויקט לשרת
scp -r ./night-ops-system-clean2 user@server:/opt/

# 2. כנס לתיקיית הפרויקט
cd /opt/night-ops-system-clean2

# 3. הרץ את האשף
sudo bash installer/install.sh
```

## מה האשף עושה?

| שלב | פעולה |
|-----|--------|
| 1 | מזהה מערכת הפעלה (Ubuntu / RHEL) |
| 2 | מתקין Node.js 20 LTS |
| 3 | מתקין PostgreSQL |
| 4 | מתקין Nginx |
| 5 | יוצר בסיס נתונים ומשתמש |
| 6 | כותב קובץ `.env` |
| 7 | מריץ `npm install` + `npm run build` |
| 8 | מריץ מיגרציות Prisma |
| 9 | יוצר משתמש אדמין ראשוני |
| 10 | מגדיר שירותי systemd + Nginx |
| 11 | מאמת שהכל עובד |

## ניהול השירות לאחר התקנה

```bash
# סטטוס
systemctl status deploycenter-backend

# לוגים בזמן אמת
journalctl -u deploycenter-backend -f

# הפעלה מחדש
systemctl restart deploycenter-backend

# עדכון גרסה
cd /opt/night-ops-system-clean2
git pull
cd backend && npm run build
systemctl restart deploycenter-backend
```
