# NightOps — Rollback Runbook

## מתי לבצע Rollback?

- שגיאות 5xx בייצור אחרי switch
- ביצועים נמוכים מהצפוי
- פונקציה שבורה שהתגלתה
- בקשת מנהל

---

## Rollback מיידי (< 1 דקה)

```bash
cd /opt/nightops/app/deployment
make rollback
```

**מה קורה:**
1. nginx חוזר ל-Blue upstream
2. `nginx -s reload` — ללא הפסקת שירות
3. Green containers נעצרים
4. DB לא נגע

---

## אחרי Rollback — בדיקת מצב

```bash
make status
make health SLOT=blue
```

---

## Rollback מ-Rollback (אם Blue גם שבור)

```bash
# הפעל Blue מחדש מגרסה קודמת
cd /opt/nightops/app
git checkout <גרסה_קודמת>

docker compose \
  -f deployment/blue/docker-compose.yml \
  --env-file /opt/nightops/blue/.env.blue \
  up -d --build

make health SLOT=blue
make rollback
```

---

## שחזור DB (במקרה קיצוני)

> **חשוב:** rollback רגיל אינו דורש שחזור DB.
> הDB הוא forward-only. שחזור רק אם migration הרס נתונים.

```bash
# מצא את הגיבוי לפני הdeploy הכושל
ls /opt/nightops/backups/

# שחזר (requires psql)
PGPASSWORD=... psql -h DB_HOST -U nightops_user nightops_prod \
  < <(gunzip -c /opt/nightops/backups/<timestamp>_<version>.sql.gz)
```

---

## לוגים לחקירה

```bash
# לוג rollback
tail -50 /opt/nightops/logs/rollback_*.log | sort | tail -50

# לוגי containers
docker logs nightops-backend-green --tail 100
docker logs nightops-backend-blue  --tail 100

# nginx
tail -50 /var/log/nginx/error.log
```
