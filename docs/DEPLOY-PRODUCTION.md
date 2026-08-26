# מדריך פריסה — שרת ייצור (Production)

מדריך זה הוא **תוספת ממוקדת-בעיות** לצד המדריך המלא והמפורט:
[`release-v2.7.9/INSTALL.md`](../release-v2.7.9/INSTALL.md) — שם נמצאות כל ההנחיות המדויקות
(Oracle Thick Mode, SMB, checklist Go-Live מלא וכו'). המסמך הזה מסכם את הזרימה, מוסיף
**checklist הכנה לפני שבונים release חדש**, וטבלת פתרון-תקלות שמשלימה את סעיף ה-Recovery ב-INSTALL.md.

סביבת היעד: RHEL 9.7 | Docker Engine 26 | PostgreSQL 16 | Oracle 11g (Thick Mode).

---

## 1. זרימת העלייה בקצרה

```
[מחשב פיתוח]                          [שרת ייצור]
build-release.sh  ──►  release-v2.7.9/  ──scp──►  /tmp/release-v2.7.9/
  - בונה images                                     │
  - מייצא נתונים מ-dev DB                            ▼
  - שומר הכל ל-tar                          sudo bash install-docker.sh
                                                     │
                                     ┌───────────────┴───────────────┐
                                     │ מזהה: התקנה חדשה / שדרוג      │
                                     │ גיבוי DB + config             │
                                     │ docker compose down            │
                                     │ docker load (images חדשים)     │
                                     │ prisma migrate deploy (אוטו')  │
                                     │ import deploycenter-data-export│
                                     │ docker compose up               │
                                     └────────────────────────────────┘
```

## 2. Checklist הכנה — לפני שמריצים `build-release.sh`

בדוק את אלה **בריפו על מחשב הפיתוח** לפני שאתה בונה release חדש להעלאה:

- [ ] **אין קומיטים לא-pushed** על הענף שממנו בונים (`git log origin/<branch>..<branch>`) — כדי
      שיש גיבוי מרוחק לגרסה שעולה לייצור.
- [ ] **עץ העבודה נקי** — `git status`; במיוחד ודא שאין קבצים זרים בתוך `backend/` (סקריפטים
      זמניים, קבצי `tmp_*`, `.xlsx`, `test-*.js` וכו') — `docker build ./backend` שולח את **כל**
      מה שיושב על הדיסק ל-build context, לא רק מה שב-git. קבצים כאלה לא מסתננים ל-image הסופי
      (multi-stage build מעתיק רק `dist`/`node_modules`/`prisma`/`package.json`), אבל הם מאטים
      build ועלולים "לדלוף" לתוך שכבות ה-builder stage. נקה או הוסף ל-`backend/.dockerignore`.
- [ ] **מיגרציות**: `ls backend/prisma/migrations` — המיגרציה האחרונה תואמת למה שכתוב ב-INSTALL.md
      של הגרסה הזו? כל migration חדשה מחוץ ל-git = לא תופעל אצל הלקוח.
- [ ] **גרסה עקבית**: `backend/package.json` `version`, ו-`backend/src/health/health.controller.ts`
      (שדה `version` בתגובת `/health`) — שניהם תואמים למספר הגרסה שאתה בונה?
- [ ] `backend/docker-entrypoint.sh` — הבאנר שמודפס בעלייה (`echo "DeployCenter vX.Y.Z"`) מעודכן?
      (קוסמטי בלבד — לא משפיע על פונקציונליות, אבל מבלבל בזמן דיבוג לוגים).
- [ ] `release-v2.7.9/.env.template` מכיל את כל המשתנים החדשים שנוספו בגרסה הזו (אם נוספו).

## 3. Checklist על השרת — לפני `install-docker.sh`

(המקור המלא: INSTALL.md §1-3, §6-7)

- [ ] `.env` נוצר מ-`.env.template` ומולאו: `DB_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`,
      VAPID keys.
- [ ] Oracle Client קבצים קיימים ב-`/DeployCenter/oracle/product/19.0.0/client_1/` (`libclntsh.so`,
      `libnnz19.so`, `libclntshcore.so`, `timezlrg_24.dat`).
- [ ] SMB mount ל-`cr_list.xls` פעיל (`ls /mnt/qc-releases/cr_list.xls`).
- [ ] אם מדובר בשדרוג: גיבוי אוטומטי ירוץ, אבל כדאי לוודא שיש מקום פנוי בדיסק ל-backup נוסף.

---

## 4. פתרון תקלות (משלים את INSTALL.md §10 Recovery)

| תסמין | סיבה סבירה | פתרון |
|---|---|---|
| `docker compose up` נכשל עם "container name already in use" | קונטיינר ישן מגרסה קודמת לא ירד | `docker compose -f /opt/deploycenter/docker-compose.yml down` ואז עלה שוב |
| `prisma migrate deploy` נכשל בעלייה (`docker logs dc-api`) | schema drift — יש שינוי בסכימה שלא תואם ל-migration history בפועל ב-DB היעד | בדוק `docker exec dc-api npx prisma migrate status`; **אל תריץ `db push` על production** — זה עוקף migration history. תקן ע"י יצירת migration חדשה תואמת ובנייה מחדש |
| `/health` מחזיר `oracle: "error"` | `ORACLE_ENABLED=false` בטבלת SystemParam (לא env var!), או Oracle Client חסר בקונטיינר | בדוק דרך AdminPanel → QC Oracle; `docker exec dc-api ls /oracle/lib/libclntsh*` |
| `/health` מחזיר `oracle_error: DPI-1047` | `LD_LIBRARY_PATH`/`ORACLE_HOME` לא מוגדרים נכון, או `timezlrg_24.dat` חסר | ראה INSTALL.md §2 — בדוק את ה-mount של תיקיית ה-Oracle Client |
| `cr_list: "error"` / `not_configured` | SMB mount לא פעיל, או `QC_RELEASES_FILE` לא הוגדר ב-AdminPanel | `docker exec dc-api ls -la /mnt/qc-releases/`; אם ריק — בדוק `mount -a` בהוסט (לא בקונטיינר) |
| אחרי שדרוג — הרשאות תפקיד "התאפסו"/השתנו ב-AdminPanel | **התנהגות ידועה ומתועדת**: ייבוא `deploycenter-data-export.json` עושה `upsert` על `RolePermissions` שדורס את הערכים הקיימים בערכי קובץ הייצוא | לפני שדרוג הבא: תעד/גבה ידנית כל הרשאה מותאמת-אישית שהוגדרה ב-AdminPanel; אחרי שדרוג — בדוק ותקן ידנית |
| משתמש admin לא זמין / סיסמה לא ידועה | — | `docker exec dc-api node /app/dist/scripts/reset-admin.js --email ... --password ... [--create]` (INSTALL.md §10) |
| התחברות מ-LDAP לא עובדת אבל local accounts כן | `LDAP_ENABLED`/`LDAP_URL`/`LDAP_BIND_DN` שגויים ב-`.env` | `docker logs dc-api --tail 50` בזמן ניסיון התחברות — NestJS ידפיס שגיאת bind/connect |
| Rollback דרוש | גרסה חדשה שברה משהו קריטי | INSTALL.md §10: `docker compose down` → שחזור `backup-pre-X.Y.Z-DATE.sql` → `docker load` ל-tar הישן → הרצה עם compose הישן |

---

## 5. פקודות אבחון מהירות

```bash
# בריאות כללית
curl http://localhost/api/health

# לוגים — רק שגיאות/אירועים קריטיים
docker logs dc-api 2>&1 | grep -E "FATAL|ERROR|Oracle|Migrations|READY"

# מצב containers
docker compose -f /opt/deploycenter/docker-compose.yml ps

# בדיקת Oracle נקודתית
curl -s -X POST http://localhost/api/health/test-oracle \
  -H "Content-Type: application/json" \
  -d '{"user":"U","password":"P","connectString":"H:1521/S"}'

# בדיקת SMB/cr_list נקודתית
curl -s -X POST http://localhost/api/health/test-cr-list \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/mnt/qc-releases/cr_list.xls"}'

# גיבוי ידני של ה-DB (לפני כל פעולה מסוכנת)
docker exec dc-postgres pg_dump -U dcuser deploycenter \
  > /opt/deploycenter/backup-$(date +%Y%m%d-%H%M).sql
```

---

## 6. checklist Go-Live סופי

זהה ל-INSTALL.md §9 — לא כפול כאן במלואו כדי לא ליצור שני מקורות אמת. **תמיד תבדוק שם** את
הרשימה המלאה (17 סעיפים: PostgreSQL, Oracle, SMB, הרשאות, Quality Hub KPIs וכו') לפני שמכריזים
על הגרסה כ"למעלה".
