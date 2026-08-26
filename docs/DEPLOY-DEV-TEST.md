# מדריך הפעלה — סביבת פיתוח (dev) וטסט (test)

מדריך זה מתאר איך להעלות את DeployCenter על מחשב פיתוח מקומי (Windows), ואיך לפתור את התקלות
שחוזרות הכי הרבה. לפריסת שרת ייצור ראה [`DEPLOY-PRODUCTION.md`](./DEPLOY-PRODUCTION.md).

---

## 1. שתי סביבות עצמאיות — dev ו-test

הפרויקט מריץ **שתי סביבות מקומיות נפרדות לגמרי** (DB, פורט, קובץ `.env` — הכל נפרד). אל תערבב
ביניהן: אם ה-backend רץ במצב dev וה-frontend מוגדר לדבר עם test (או להפך) — תקבלו `Network Error`.

| | Backend | Frontend | Postgres | DB Name |
|---|---|---|---|---|
| **dev** | `npm run start` (`NODE_ENV=dev`) → port **3000** | `npm start` → port **3001** (ברירת מחדל) | `localhost:5432` | `nightops_dev` |
| **test** | `npm run start:test` (`NODE_ENV=test`) → port **3001** | `npm run start:test` → port **3002**, `REACT_APP_API_URL=http://localhost:3001` | `localhost:5433` | `nightops_test` |

> ⚠️ **מלכודת ידועה בסביבה הזו**: לקובץ `frontend/.env` (לא `.env.test`) יש כרגע ערכים קבועים
> (`PORT=3002`, `REACT_APP_API_URL=http://localhost:3001`) שנטענים גם כש-מריצים סתם `npm start`
> הרגיל — כלומר גם ההרצה ה"רגילה" מתנהגת כמו test מבחינת הפורט שהיא פונה אליו. אם מרימים
> backend רגיל (`npm run start`, פורט 3000) והפרונט נשאר עם ברירת המחדל הזו — הוא ינסה לדבר עם
> פורט 3001 שאין בו כלום ⇒ `Network Error` בדפדפן. שני פתרונות:
> - להריץ גם את ה-backend במצב test (`npm run start:test`, פורט 3001) כדי שהצדדים יתאימו, **או**
> - לדרוס את המשתנה בזמן ההרצה: `REACT_APP_API_URL=http://localhost:3000 npm start`
> - הפתרון הקבוע: לערוך את `frontend/.env` בעצמכם (Claude חסום מקריאה/כתיבה של קבצי `.env*`
>   מטעמי אבטחה) ולוודא שהוא תואם לפורט ה-backend שאתם בפועל מריצים.

---

## 2. דרישות מקדימות

- Docker Desktop רץ
- Node.js (תואם ל-`backend/package.json` / `frontend/package.json`)
- `npm install` בוצע גם ב-`backend/` וגם ב-`frontend/`

---

## 3. הפעלה — Dev

```bash
# 1. DB (Postgres dev, פורט 5432)
cd backend
npm run db:dev

# 2. מיגרציות
npm run migrate:dev

# 3. Backend (פורט 3000)
npm run start

# 4. Frontend — בטרמינל נפרד (פורט תלוי ב-frontend/.env, ראה סעיף 1!)
cd ../frontend
npm start
```

## 4. הפעלה — Test

```bash
cd backend
npm run db:test          # Postgres test, פורט 5433
npm run migrate:test
npm run start:test       # Backend, פורט 3001

cd ../frontend
npm run start:test       # Frontend, פורט 3002, מכוון אוטומטית ל-3001
```

הכי בטוח להריץ את **הזוג התואם** (dev+dev או test+test) ולא לערבב — כי ה-CORS וה-`REACT_APP_API_URL`
מוגדרים לפי זוגות קבועים (ראה סעיף 6).

---

## 5. בדיקת תקינות מהירה

```bash
# Backend חי?
curl -s http://localhost:3000/health   # dev
curl -s http://localhost:3001/health   # test

# מה כתובת ה-API שהפרונט בפועל בנוי איתו (בדיקה בלי לפתוח דפדפן):
curl -s http://localhost:3002/static/js/bundle.js | grep -o 'http://localhost:[0-9]\{4\}' | sort | uniq -c
```

התוצאה השנייה צריכה להראות רוב המופעים מצביעים לפורט ה-backend שבאמת רץ. אם הרוב מצביע לפורט אחר —
זה בדיוק ה-bug שתואר בסעיף 1.

התחברות (משתמשים מקומיים שעוקפים LDAP): `nissim@test.com` / `nisim@dev.com` / `hay@dev.com`,
או `reg-admin@test.com` / `Test1234!` בסביבת test.

---

## 6. פתרון בעיות נפוצות

| תסמין | סיבה סבירה | פתרון |
|---|---|---|
| `Network Error` / `AxiosError` בדפדפן מיד אחרי טעינה | `frontend/.env`'s `REACT_APP_API_URL` לא תואם לפורט ה-backend שבאמת רץ | בדוק עם ה-curl בסעיף 5; הרץ עם override (`REACT_APP_API_URL=http://localhost:PORT npm start`) או ערוך את `frontend/.env` |
| `Something is already running on port 3002` (או 3000/3001) | תהליך ישן עדיין תפוס על הפורט (קרה גם אחרי `TaskStop`/סגירת טרמינל — תהליך ה-node הילד לפעמים שורד) | `netstat -ano \| grep ":PORT" \| grep LISTENING` למצוא PID, ואז `powershell -Command "Stop-Process -Id PID -Force"` |
| שגיאת CORS בקונסולה (`blocked by CORS policy`) | ה-origin של הפרונט לא ברשימה הקבועה ב-`backend/src/main.ts` (`3002,3003,3011,3013` + `CORS_ORIGINS` מה-env) | הרץ frontend על אחד הפורטים המורשים, או הוסף origin ל-`CORS_ORIGINS` ב-`.env` הרלוונטי |
| Backend נופל מיד עם שגיאת חיבור ל-DB (`ECONNREFUSED` ל-5432/5433) | קונטיינר ה-Postgres לא רץ | `docker ps` לוודא ש-`nightops-postgres`(-test) רץ; אם לא: `npm run db:dev` / `npm run db:test` |
| שגיאות Prisma / טבלה חסרה | מיגרציות לא הורצו על ה-DB הזה, או schema drift | `npm run migrate:dev` (או `migrate:test`); לבדיקה עמוקה יותר `npx prisma migrate status` |
| התחברות נכשלת גם עם משתמש/סיסמה נכונים | `JWT_SECRET` חסר/השתנה ב-`.env` הרלוונטי, או שמתחברים ל-DB הלא נכון (dev מול test — משתמשים שונים בכל אחד) | ודא איזה `.env.{NODE_ENV}` בפועל נטען (הלוג של ה-backend מדפיס `ENV / PORT / DB` בעלייה — תואם למה שציפית?) |
| מסך לבן / "Compiling..." תקוע | שגיאת קומפילציה ב-React | תראה את הפלט המלא של `npm start` בטרמינל — react-scripts מדפיס את השגיאה שם, לא רק בדפדפן |
| `npm run push:dev` "לא רואה" נתונים שהיו קיימים | `push:dev` מצביע ל-DB בשם `nightops_dev` בעוד שה-DB האמיתי בשימוש נקרא אחרת (בעיה ידועה בסביבה הזו) | השתמש ב-`npx prisma db push` הפשוט (עם ה-`DATABASE_URL` שכבר טעון מה-`.env`) במקום `npm run push:dev` |

---

## 7. פקודות שימושיות

```bash
# מצב containers
docker ps

# לוגים חיים של ה-backend (בטרמינל שבו הוא רץ, או:)
# אם רץ ברקע דרך Claude — קרא את קובץ ה-output של המשימה

# בדיקת מי מחזיק פורט ולסגור אותו
netstat -ano | grep ":3000" | grep LISTENING
powershell -Command "Stop-Process -Id <PID> -Force"

# Prisma Studio (חקירת DB ויזואלית)
cd backend && npm run studio:dev    # או studio:test
```
