# Night-Ops System — תיק מערכת טכני

> גרסה: 1.0 | תאריך: מאי 2026

---

## תוכן עניינים

1. [סקירה כללית](#1-סקירה-כללית)
2. [ארכיטקטורה](#2-ארכיטקטורה)
3. [מסד הנתונים — סכמה מלאה](#3-מסד-הנתונים)
4. [מודולי הבאקאנד](#4-מודולי-הבאקאנד)
5. [ממשק הפרונטאנד](#5-ממשק-הפרונטאנד)
6. [זרימות נתונים מרכזיות](#6-זרימות-נתונים)
7. [אבטחה והרשאות](#7-אבטחה-והרשאות)
8. [אינטגרציות חיצוניות](#8-אינטגרציות-חיצוניות)
9. [תצורה ומשתני סביבה](#9-תצורה)
10. [מה נשאר להשלים](#10-מה-נשאר-להשלים)

---

## 1. סקירה כללית

**Night-Ops System** (מכונה גם "Deploy Center") הוא מערכת ניהול גרסאות לטיפול בתהליך הכנה, תיאום וביצוע של שחרורי תוכנה (deployments) בארגון גדול המערב עשרות צוותים.

### בעיה שהמערכת פותרת

שחרור תוכנה גדול מערב:
- עשרות צוותי פיתוח, כל אחד עם משימות שונות
- תלויות בין משימות (משימה B לא מתחילה לפני שA סיימה)
- ניהול GO/NO-GO — האם להמשיך לשלב הבא
- תיאום בין ליל ההטמעה לבוקר שלמחרת
- תיעוד של כל שלב לדיווח ולמשפטי תקלות

### פתרון המערכת

- **לפני הלילה:** הצוותים מגישים משימות דרך ממשק ייעודי, מנהל הגרסה בונה תוכנית אחידה
- **בלילה:** מעקב בזמן אמת, ניהול תקלות, ניהול GO/NO-GO
- **אחרי הלילה:** דוחות אוטומטיים, בקרות בוקר, ארכיון

---

## 2. ארכיטקטורה

### 2.1 תרשים ארכיטקטורה

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                      │
│                                                           │
│  React 19 + TypeScript + MUI                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ManagerDash  │  │EmployeeDash  │  │  TeamLead View  │ │
│  │  (מנהלים)  │  │   (עובדים)   │  │  (ראשי צוות)   │ │
│  └─────────────┘  └──────────────┘  └─────────────────┘ │
│          │               │                   │            │
│          └───────────────┴───────────────────┘            │
│                          │                                │
│          HTTP REST (Axios)  +  WebSocket (Socket.IO)      │
└────────────────────────────┬────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  NestJS Backend  │
                    │   Port 3000      │
                    │                  │
                    │  ┌────────────┐  │
                    │  │ JwtGuard   │  │
                    │  │ (auth)     │  │
                    │  └─────┬──────┘  │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │  14 Modules│  │
                    │  │  (REST API)│  │
                    │  └─────┬──────┘  │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │  Prisma ORM│  │
                    │  └─────┬──────┘  │
                    └────────┼─────────┘
                             │
               ┌─────────────┴──────────────┐
               │                            │
       ┌───────▼───────┐         ┌──────────▼──────┐
       │  PostgreSQL    │         │  Oracle DB       │
       │  (מסד ראשי)   │         │  (QC — אופציה)  │
       └───────────────┘         └─────────────────┘
```

### 2.2 סטק טכנולוגי

| שכבה | טכנולוגיה | גרסה |
|------|-----------|-------|
| פרונטאנד | React + TypeScript | 19.x |
| UI Library | Material-UI (MUI) | 9.x |
| HTTP Client | Axios | 1.x |
| WebSocket Client | Socket.IO Client | 4.x |
| ניתוב פרונטאנד | React Router | 7.x |
| באקאנד Framework | NestJS | 11.x |
| שפה | TypeScript | 5.x |
| ORM | Prisma | 5.x |
| מסד נתונים | PostgreSQL | 15+ |
| אימות | JWT + Passport.js | — |
| הצפנת סיסמאות | bcrypt | 6.x |
| WebSocket Server | Socket.IO | 4.x |
| אבטחה | Helmet.js | 8.x |
| Rate Limiting | @nestjs/throttler | 6.x |
| יצוא DOCX | docx | 9.x |
| קריאת Excel | xlsx (SheetJS) | 0.18 |
| Oracle Client | oracledb | 6.x |

### 2.3 תצורת שרת

| הגדרה | ערך |
|-------|-----|
| פורט ברירת מחדל | 3000 |
| CORS מורשה | localhost:3001, :3002, :3003 |
| Rate Limit | 100 בקשות / דקה / IP |
| Rate Limit Login | 10 ניסיונות / 15 דקות / IP |
| Validation | whitelist=true, transform=true |
| Headers | Helmet.js (CSP, X-Frame-Options, ...) |

---

## 3. מסד הנתונים

### 3.1 Enums

```prisma
enum Role {
  ADMIN           // גישה מלאה לכל
  RELEASE_MANAGER // מנהל לילה — ניהול גרסות
  TEAM_LEAD       // ראש צוות — הגשת משימות
  EMPLOYEE        // עובד — עדכון סטטוס בלבד
  VIEWER          // צפייה בלבד
}

enum TaskStatus {
  OPEN        // פתוח לביצוע
  IN_PROGRESS // בביצוע
  BLOCKED     // חסום
  WAITING     // ממתין לתלות
  DONE        // הושלם
  FAILED      // נכשל
  ROLLED_BACK // בוצע rollback
}

enum VersionStatus {
  DRAFT        // טיוטה
  COLLECTING   // איסוף משימות מהצוותים
  REFINING     // טיוב תלויות
  REVIEW       // ישיבת מעבר
  APPROVED     // מאושרת לביצוע
  REHEARSAL    // חזרה גנרלית
  ACTIVE       // ביצוע הלילה
  MORNING_AFTER // פעילות בוקר
  COMPLETED    // הושלמה
  ROLLED_BACK  // בוצע Rollback
}

enum SubmissionStatus {
  NOT_STARTED // לא התחיל
  IN_PROGRESS // בתהליך
  SUBMITTED   // הגיש
}
```

### 3.2 מודלי הנתונים

#### User — משתמש
```
id          UUID (PK)
fullName    String
email       String (unique)
phone       String?
password    String (bcrypt)
role        Role (default: EMPLOYEE)
active      Boolean (default: true)
createdAt   DateTime
updatedAt   DateTime
```

#### Team — צוות
```
id          UUID (PK)
name        String
description String?
active      Boolean (default: true)
createdAt   DateTime
```

#### TeamMember — חברות בצוות
```
userId  → User
teamId  → Team
isLead  Boolean (false = חבר, true = ראש צוות)
[PK: userId + teamId]
```

#### Version — גרסה
```
id                UUID (PK)
name              String (unique)
description       String?
status            VersionStatus (default: DRAFT)
createdBy         → User
approvedBy        → User?
approvedAt        DateTime?
plannedStart      DateTime?
plannedEnd        DateTime?
actualStart       DateTime?
completedAt       DateTime?
collectionDeadline DateTime?
reviewMeetingTime  DateTime?
importedFileName   String?
isArchived         Boolean (false)
archivedAt         DateTime?
qcReleaseId        → QcRelease?
lastNightSnapshot  JSON?    (snapshot of tasks at ACTIVE→MORNING_AFTER)
lastNightAt        DateTime?
lastRehearsalAt    DateTime?
```

#### Phase — שלב
```
id          UUID (PK)
versionId   → Version
teamId      → Team?
name        String
orderIndex  Int
environment Environment (HOT/HOTNET/BOTH)
isGoNoGo   Boolean (false) ← שלב GO/NO GO
plannedStart DateTime?
plannedEnd   DateTime?
createdAt    DateTime
```

#### SubPhase — תת-שלב
```
id         UUID (PK)
phaseId    → Phase
name       String
orderIndex Int
```

#### Task — משימה
```
id               UUID (PK)
title            String
description      String?
crNumber         String?
application      String?
status           TaskStatus (default: OPEN)
priority         Priority (default: MEDIUM)
assignedTeamId   → Team?
assignedUserId   → User?
assignedUserName String?
blockedReason    String?
delayReason      String?
notes            String?
dependencyNote   String?
duration         String?     (e.g. "30" or "1ש30ד")
orderIndex       Int?
plannedStart     DateTime?
plannedEnd       DateTime?
actualStart      DateTime?
actualFinish     DateTime?
dueDate          DateTime?
isCritical       Boolean?
isCriticalForGo  Boolean?
morningFollowup  Boolean?
environment      Environment?
executionStatus  ExecutionStatus?
createdBy        → User
subPhaseId       → SubPhase?
versionId        → Version?
```

#### TaskDependency — תלות בין משימות
```
taskId          → Task (PK)
dependsOnTaskId → Task (PK)
createdAt       DateTime
[PK: taskId + dependsOnTaskId]
```

#### TeamSubmission — הגשת צוות
```
id          UUID (PK)
versionId   → Version
teamId      → Team
status      SubmissionStatus (default: NOT_STARTED)
submittedBy → User?
submittedAt DateTime?
taskCount   Int (0)
[unique: versionId + teamId]
```

#### TaskProposal — הצעת משימה
```
id             UUID (PK)
versionId      → Version
teamId         → Team
submittedBy    → User
title          String
phase          Int (1-4)
app            String?
estimatedMins  Int?
crNumber       String?
crLabel        String?
notes          String?
assignedUserName String?
status         ProposalStatus (DRAFT/READY)
usedInTaskId   String?
```

#### CrPlan — תכנית CR
```
id                UUID (PK)
versionId         → Version
teamId            → Team
crNumber          String
crLabel           String?
rollbackPlan      String?
gradualRollout    Boolean (false)
gradualDetails    String?
nightTestingNotes String?
morningMonitoring String?
[unique: versionId + teamId + crNumber]
```

#### NightSummary — סיכום לילה
```
id                  UUID (PK)
versionId           → Version (unique)
headline            String?
morningNotes        String?
crData              JSON?
recipientsSnapshot  JSON?
sentAt              DateTime?
sentBy              String?
```

#### AuditLog — לוג שינויים
```
id         UUID (PK)
userId     → User
taskId     → Task
action     String (TASK_CREATED / STATUS_CHANGED / ...)
beforeData JSON?
afterData  JSON?
ipAddress  String?
createdAt  DateTime
```

#### QcRelease — גרסת QC
```
id               UUID (PK)
relId            Int (unique)
relName          String
goLiveDate       DateTime?
rehearsalDate    DateTime?
filterDate       DateTime?
active           Boolean (true)
lastSyncAt       DateTime?
```

---

## 4. מודולי הבאקאנד

הבאקאנד מורכב מ-14 מודולים עצמאיים. כל מודול כולל Controller (ניתוב) ו-Service (לוגיקה עסקית).

---

### 4.1 AUTH — אימות משתמשים

**מה הוא עושה:** מנהל התחברות ומנפיק טוקני JWT.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| POST | `/auth/login` | ציבורי | התחברות עם email/password |

**קלט:**
```json
{ "email": "user@example.com", "password": "MyPassword1!" }
```

**פלט:**
```json
{
  "token": "eyJhbGc...",
  "user": { "id": "...", "email": "...", "role": "TEAM_LEAD", "fullName": "..." }
}
```

**לוגיקה עסקית:**
- חיפוש אימייל case-insensitive
- בדיקת `active=true` (משתמש מושבת → שגיאה גנרית)
- השוואת bcrypt
- JWT מכיל: `{sub: userId, role: userRole}` — ללא fullName
- Rate limit: 10 ניסיונות / 15 דקות / IP

---

### 4.2 USERS — ניהול משתמשים

**מה הוא עושה:** CRUD משתמשים, שיוך לצוותים, סנכרון ממערכת QC.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| GET | `/users` | TEAM_LEAD+ | רשימת כל המשתמשים הפעילים |
| POST | `/users` | ADMIN | יצירת משתמש חדש |
| PATCH | `/users/:id` | ADMIN | עדכון פרטי משתמש |
| PATCH | `/users/:id/team` | ADMIN | שיוך/הסרה מצוות |
| PATCH | `/users/:id/password` | ADMIN | איפוס סיסמה |
| POST | `/users/sync-qc` | ADMIN | סנכרון מ-Oracle QC |

**לוגיקה סנכרון QC:**
1. מביא רשימת עובדים מ-Oracle (אם `ORACLE_ENABLED=true`) או מרשימה hardcoded
2. יוצר משתמשים חדשים עם סיסמת ברירת מחדל "123456"
3. מעדכן שמות קיימים
4. **מנטרל** משתמשים שאינם ברשימת QC (למעט 3 חשבונות אדמין)

---

### 4.3 TEAMS — ניהול צוותים

**מה הוא עושה:** CRUD צוותים ורשימת החברים בכל צוות.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| GET | `/teams` | כולם | רשימת צוותים + חברים |
| GET | `/teams/:id` | כולם | פרטי צוות + 20 משימות אחרונות |
| POST | `/teams` | RELEASE_MANAGER+ | יצירת צוות |
| PATCH | `/teams/:id` | RELEASE_MANAGER+ | עדכון שם/תיאור/פעיל |
| POST | `/teams/:id/members` | RELEASE_MANAGER+ | הוספת חבר (userId + isLead) |
| DELETE | `/teams/:id/members/:userId` | RELEASE_MANAGER+ | הסרת חבר |
| DELETE | `/teams/:id` | ADMIN | מחיקת צוות (רק אם ריק) |

---

### 4.4 TASKS — ניהול משימות

**מה הוא עושה:** CRUD משימות, עדכון סטטוס, לוג שינויים, פתרון תלויות אוטומטי.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| GET | `/tasks` | כולם | רשימת משימות (EMPLOYEE — צוותו בלבד) |
| GET | `/tasks/:id` | כולם | משימה + 20 לוגים + תלויות |
| POST | `/tasks` | TEAM_LEAD+ | יצירת משימה (כותרת חובה) |
| PATCH | `/tasks/:id/status` | כולם | עדכון סטטוס (enum validated) |
| PATCH | `/tasks/:id` | כולם | עדכון פרטים (נעול בגרסה ACTIVE) |
| POST | `/tasks/:id/duplicate` | TEAM_LEAD+ | שכפול משימה |
| DELETE | `/tasks/:id` | RELEASE_MANAGER+ | מחיקת משימה |

**לוגיקה מרכזית:**
- **Version Lock:** כאשר גרסה ACTIVE, שדות מבניים (כותרת, שיוך, CR) נעולים
- **פתרון תלויות:** כאשר משימה מסתיימת (DONE), בודקת את כל התלויות בה — אם כולן הושלמו, המשימה הממתינה עוברת ל-OPEN אוטומטית
- **Audit Trail:** כל שינוי נרשם עם before/after data ו-IP

---

### 4.5 VERSIONS — ניהול גרסאות

**מה הוא עושה:** ניהול מחזור חיים מלא של גרסה — מטיוטה ועד השלמה.

#### endpoints ניהול גרסה

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| GET | `/versions` | כולם | רשימת גרסאות עם ספירת משימות |
| GET | `/versions/:id` | כולם | גרסה מלאה: שלבים→תת-שלבים→משימות + involvedTeamIds |
| POST | `/versions` | RELEASE_MANAGER+ | יצירת גרסה |
| DELETE | `/versions/:id` | ADMIN | מחיקה מלאה (cascade) |
| PATCH | `/versions/:id/archive` | RELEASE_MANAGER+ | ארכוב |
| PATCH | `/versions/:id/restore` | RELEASE_MANAGER+ | שחזור מארכיב |

#### endpoints ניהול סטטוס

| Method | Endpoint | תיאור |
|--------|----------|-------|
| PATCH | `/versions/:id/status` | מעבר סטטוס (state machine + guard) |
| POST | `/versions/:id/end-rehearsal` | סיום חזרה גנרלית |

**State Machine:**
```
DRAFT → COLLECTING → REFINING → REVIEW → APPROVED
                                           ↓
                               REHEARSAL (end-rehearsal) → APPROVED
                                           ↓
                                    ACTIVE → MORNING_AFTER → COMPLETED
                                           ↓
                                    ROLLED_BACK
```

**Guard COLLECTING → REFINING:**
- מזהה "צוותים מעורבים" = צוותים שיש להם TaskProposal עם crNumber
- בודק שכולם SUBMITTED
- אם לא: שגיאה עם רשימת שמות
- אם `force=true` + RELEASE_MANAGER: עוקף את הבדיקה

#### endpoints שלבים ותת-שלבים

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| POST | `/versions/:id/phases` | RELEASE_MANAGER+ | הוספת שלב |
| POST | `/versions/:id/seed-phases` | RELEASE_MANAGER+ | יצירת שלבים ברירת מחדל |
| PATCH | `/versions/phases/:phaseId` | RELEASE_MANAGER+ | עריכת שלב (שם, isGoNoGo) |
| DELETE | `/versions/phases/:phaseId` | RELEASE_MANAGER+ | מחיקת שלב |
| POST | `/versions/phases/:phaseId/sub-phases` | RELEASE_MANAGER+ | הוספת תת-שלב |
| POST | `/versions/sub-phases/:subPhaseId/tasks` | TEAM_LEAD+ | הוספת משימה לתת-שלב |
| POST | `/versions/sub-phases/:subPhaseId/reorder` | TEAM_LEAD+ | סידור מחדש |

#### endpoints הגשה וסנכרון

| Method | Endpoint | תיאור |
|--------|----------|-------|
| POST | `/versions/:id/submit/:teamId` | הגשת צוות (TEAM_LEAD — צוותו בלבד) |
| GET | `/versions/:id/submissions` | סטטוס הגשות |

#### endpoints תזמון ותלויות

| Method | Endpoint | תיאור |
|--------|----------|-------|
| POST | `/versions/:id/reschedule` | תזמון מחדש (עם/בלי תלויות, preview mode) |
| POST | `/versions/:id/apply-schedule` | החלת תזמון bulk |
| POST | `/versions/:id/auto-deps-by-user` | יצירת תלויות אוטומטיות לפי עובד |
| POST | `/versions/:id/resolve-deps` | פתרון תלויות |
| POST | `/versions/tasks/:taskId/dependencies` | הוספת תלות |
| POST | `/versions/tasks/:taskId/dependencies/remove` | הסרת תלות |
| PATCH | `/versions/:id/reassign-tasks` | החלפת עובד במשימות |
| POST | `/versions/:id/fix-task-order` | תיקון מספור |

---

### 4.6 IMPORT — ייבוא מ-Excel

**מה הוא עושה:** יצירת גרסה שלמה מקובץ Excel.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| POST | `/import/excel` | RELEASE_MANAGER+ | העלאת קובץ xlsx |

**פורמט הקובץ:**
- זיהוי לפי **צבע:** כחול (#00B0F0) = שלב, כתום (#BF9000) = תת-שלב, ירוק (#00B050) = GO/NOGO
- fallback לפי **הזחה:** 0 = שלב, 1-3 = תת-שלב, 4+ = משימה
- **עמודות:** כותרת, שעת התחלה, משך, CR, מערכת, צוות, עובד, תלויות (מספרי שורה)
- **טיפול בשעות:** שעות 00:00–03:59 מחושבות כיום המחרת

**מה נוצר:**
1. גרסה חדשה עם השם שסופק
2. שלבים, תת-שלבים, משימות
3. isGoNoGo=true על השלב השני מהסוף (אוטומטי)
4. TeamSubmission לכל צוות פעיל
5. תלויות לפי מספרי predecessor

---

### 4.7 SUMMARY — דוחות סיכום

**מה הוא עושה:** יצירת דוחות Word (DOCX) לסיכום לילה וחזרה גנרלית.

| Method | Endpoint | הרשאה | תיאור |
|--------|----------|-------|-------|
| GET | `/summary/:versionId` | כולם | שליפת סיכום לילה |
| POST | `/summary/:versionId/approve` | RELEASE_MANAGER+ | שמירת/אישור סיכום |
| GET | `/summary/:versionId/rehearsal` | כולם | שליפת סיכום חזרה |
| POST | `/summary/:versionId/rehearsal/approve` | RELEASE_MANAGER+ | אישור סיכום חזרה |
| POST | `/summary/:versionId/night-download` | TEAM_LEAD+ | הורדת DOCX |
| POST | `/summary/:versionId/rehearsal-download` | TEAM_LEAD+ | הורדת DOCX חזרה |

**לוגיקה GO/NO GO:**
- השלב המסומן `isGoNoGo=true` מגדיר את "נקודת ה-GO"
- משימות **לפניו** (orderIndex ≤ goNogo.orderIndex) = חוסמות אישור
- משימות **אחריו** = "בוקר לאחר גרסה" — לא חוסמות

---

### 4.8 EVENTS — WebSocket

**מה הוא עושה:** תקשורת בזמן אמת בין כל הלקוחות המחוברים.

**Events:**

| Event | כיוון | תיאור |
|-------|-------|-------|
| `JOIN` | Client→Server | הצטרפות + רישום userId |
| `USER_ONLINE` | Server→All | שידור כניסת משתמש |
| `USER_OFFLINE` | Server→All | שידור עזיבת משתמש |
| `TASK_UPDATED` | Server→All | משימה השתנתה |
| `TASK_BLOCKED` | Server→All | משימה נחסמה (דחוף) |
| `VERSION_UPDATED` | Server→All | גרסה השתנתה |
| `GO_DECISION` | Server→All | החלטת GO/NO-GO |

---

### 4.9 PERMISSIONS — הרשאות

**מה הוא עושה:** מטריצת הרשאות לפי תפקיד.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/permissions` | כל מטריצת ההרשאות |
| PUT | `/permissions/:role` | עדכון הרשאות תפקיד |

**הרשאות מוגדרות (13):**
```
מסכים: screen:prep, screen:handoff, screen:timeline,
        screen:night, screen:summary, screen:admin

פעולות: action:import, action:gonogo, action:task_status,
         action:user_manage, action:override_version_edit,
         action:select_all_tasks, action:template_delete
```

---

### 4.10 QC — אינטגרציה עם מערכת QC

**מה הוא עושה:** שאילתות על כיסוי בדיקות, ליקויים ורשימת CRs.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/qc/test-coverage` | כיסוי בדיקות |
| GET | `/qc/defects` | ליקויים |
| GET | `/qc/cr-items` | רשימת CRים (לטופס הגשת משימות) |

> ⚠️ **כרגע:** כל הנתונים הם mock. כאשר `QC_ENABLED=true` — חיבור ל-Oracle (בפיתוח).

---

### 4.11 QC-RELEASES — גרסאות QC

**מה הוא עושה:** סנכרון גרסאות QC מ-Oracle לשימוש בעת יצירת גרסה.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/qc-releases/active` | גרסאות עם filterDate ≥ 30 יום אחורה |
| POST | `/qc-releases/sync` | סנכרון ידני |
| PATCH | `/qc-releases/:id/toggle` | הפעלה/ביטול |

**סנכרון אוטומטי:** בסטארטאפ (OnModuleInit) — סנכרון מ-Oracle אם `ORACLE_ENABLED=true`.

---

### 4.12 VERSION-TEMPLATES — תבניות גרסה

**מה הוא עושה:** שמירת מבנה גרסה כתבנית לשימוש חוזר.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/version-templates` | רשימת תבניות |
| POST | `/version-templates/from-version/:versionId` | שמירה מגרסה קיימת |
| POST | `/version-templates/:id/apply-to-version/:versionId` | החלה על גרסה |
| PATCH | `/version-templates/:id` | עדכון מטאדאטה |
| DELETE | `/version-templates/:id` | מחיקה (ADMIN בלבד) |

**לוגיקה:** שמירת תלויות כ-index triplets `[phaseIdx, subPhaseIdx, taskIdx]` כדי שיוכלו להתאים לאחר יצירת IDs חדשים.

---

### 4.13 TASK-PROPOSALS — הצעות משימה

**מה הוא עושה:** ממשק להגשת הצעות משימה מראשי צוות לפני הגשתן הרשמית.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/task-proposals/version/:versionId` | הצעות לגרסה |
| POST | `/task-proposals/version/:versionId` | יצירת הצעה |
| PATCH | `/task-proposals/:id` | עריכת הצעה |
| DELETE | `/task-proposals/:id` | מחיקה |
| PATCH | `/task-proposals/:id/mark-used` | סימון "שומש" |

**שלבים (1–4):**
- 1 = בוקר לפני גרסה
- 2 = HOTNET
- 3 = HOT
- 4 = בוקר לאחר גרסה

---

### 4.14 CR-PLANS — תכניות CR

**מה הוא עושה:** תיעוד rollback, בדיקות ובקרת בוקר לכל CR.

| Method | Endpoint | תיאור |
|--------|----------|-------|
| GET | `/cr-plans/version/:versionId` | תכניות CR לגרסה |
| POST | `/cr-plans/version/:versionId` | יצירה/עדכון (upsert) |
| DELETE | `/cr-plans/:id` | מחיקה |

---

## 5. ממשק הפרונטאנד

### 5.1 רכיבים ראשיים

| רכיב | מטרה |
|------|------|
| `Login.tsx` | מסך התחברות |
| `App.tsx` | ניתוב לפי תפקיד (ManagerDashboard / EmployeeDashboard) |
| `ManagerDashboard.tsx` | לוח בקרה למנהלים וראשי צוות, כולל ניווט לכל המסכים |
| `VersionsView.tsx` | רשימת גרסאות, יצירה, ניהול סטטוס, תצוגת תוכנית |
| `WarRoom.tsx` | חדר מצב — מעקב בזמן אמת בלילה |
| `TeamView.tsx` | תצוגת משימות לפי צוות עם anomaly detection |
| `TeamLeadProposalView.tsx` | הגשת הצעות + תכנית CR + "סיימתי הגשה" |
| `NightSummary.tsx` | עריכה ואישור דוח סיכום |
| `ImportView.tsx` | העלאת קובץ Excel |
| `TimelineView.tsx` | ציר זמן / Gantt |
| `AdminPanel.tsx` | ניהול משתמשים, צוותים, הרשאות |
| `ConfirmDialog.tsx` | דיאלוג אישור פעולות |

### 5.2 Context ו-Hooks

| קובץ | תפקיד |
|------|-------|
| `PermissionsContext.tsx` | ספקית הרשאות — can(permission) לכל רכיב |
| `useSocket.ts` | ניהול חיבור WebSocket + event handlers |

### 5.3 Feature Flags

```ts
// frontend/src/featureFlags.ts
FEATURES.TEAM_LEAD_PROPOSAL = true  // מסך הגשת משימות לראש צוות
```

---

## 6. זרימות נתונים

### 6.1 זרימת אימות

```
1. POST /auth/login {email, password}
2. bcrypt.compare(password, hash)
3. JWT signed {sub: userId, role}
4. localStorage.setItem('deploycenter_token', jwt)
5. כל בקשה: Authorization: Bearer <jwt>
6. JwtGuard: jwt.verify() → req.user = {sub, role}
```

### 6.2 מחזור חיים גרסה מלא

```
מנהל יוצר גרסה (DRAFT)
  ↓
DRAFT → COLLECTING
  ↓ ראשי צוות מגישים הצעות
  ↓ כל ראש צוות לוחץ "סיימתי הגשה"
COLLECTING → REFINING [guard: כל הצוותים עם CR הגישו]
  ↓ מנהל בונה תוכנית, מגדיר תלויות, מתזמן
REFINING → REVIEW
  ↓ ישיבת מעבר
REVIEW → APPROVED
  ↓
APPROVED → REHEARSAL (חזרה גנרלית)
  ↓ end-rehearsal
APPROVED → ACTIVE (ביצוע ליל הגרסה)
  ↓ עדכון סטטוסים בזמן אמת
ACTIVE → MORNING_AFTER
  ↓ snapshot נשמר
MORNING_AFTER → COMPLETED [guard: כל משימות terminal + night summary אושר]
```

### 6.3 זרימת פתרון תלויות

```
Task A: DONE
  → autoOpenDependents(taskA.id)
  → מציאת כל Tasks שתלויים ב-A
  → לכל תלוי: בדוק שכל התלויות שלו (לא רק A) = DONE
  → אם כן: Task B: WAITING → OPEN
  → Broadcast TASK_UPDATED via WebSocket
```

---

## 7. אבטחה והרשאות

### 7.1 מטריצת תפקידים

| פעולה | ADMIN | RELEASE_MANAGER | TEAM_LEAD | EMPLOYEE | VIEWER |
|-------|-------|-----------------|-----------|----------|--------|
| יצירת גרסה | ✓ | ✓ | — | — | — |
| שינוי סטטוס גרסה | ✓ | ✓ | — | — | — |
| עריכת שלב/תת-שלב | ✓ | ✓ | — | — | — |
| הגשת הצעות | ✓ | ✓ | ✓ | — | — |
| הגשת צוות | ✓ | ✓ | ✓ (צוותו) | — | — |
| עדכון סטטוס משימה | ✓ | ✓ | ✓ | ✓ | — |
| יצירת משימה | ✓ | ✓ | ✓ | — | — |
| מחיקת משימה | ✓ | ✓ | — | — | — |
| ניהול משתמשים | ✓ | — | — | — | — |
| מחיקת גרסה | ✓ | — | — | — | — |

### 7.2 אמצעי אבטחה

1. **JWT:** חתימה עם JWT_SECRET, תוקף לפי הגדרה
2. **bcrypt:** סיסמאות מוצפנות (salt rounds: 10)
3. **Rate Limiting:** 100 req/min גלובלי; 10 ניסיונות login / 15 דקות
4. **CORS:** מוגבל לאורגינים ספציפיים
5. **Helmet.js:** CSP, X-Frame-Options, ועוד
6. **Whitelist Validation:** שדות לא מוכרים נמחקים
7. **שגיאות גנריות:** login לא חושף אם אימייל קיים
8. **Audit Log:** כל שינוי משימה מתועד עם IP ו-before/after
9. **Cross-Team Guard:** ראש צוות יכול להגיש רק עבור צוותו

---

## 8. אינטגרציות חיצוניות

### 8.1 Oracle DB (QC System)

**מטרה:** סנכרון משתמשים וגרסאות QC.

| משתנה | תיאור |
|-------|-------|
| `ORACLE_ENABLED` | true/false — האם לחבר |
| `ORACLE_USER` | שם משתמש Oracle |
| `ORACLE_PASSWORD` | סיסמת Oracle |
| `ORACLE_CONNECT_STRING` | host:port/service_name |

**כשלא מחובר:** fallback לרשימה hardcoded (170+ עובדים).

### 8.2 Excel Import (SheetJS)

קריאת קבצי xlsx/xls עם:
- ניתוח צבעי תאים
- חישוב זמנים
- בניית עץ שלבים→תת-שלבים→משימות

### 8.3 DOCX Generation (docx library)

יצירת דוחות Word עם:
- תמיכה ב-RTL עברית
- גופן Arial
- צבעים לפי סטטוס
- טבלאות משימות

---

## 9. תצורה

### 9.1 משתני סביבה — Mandatory

```env
JWT_SECRET=<מחרוזת-סודית-ארוכה-ומורכבת>
DATABASE_URL=postgresql://user:password@host:5432/nightops_db
```

### 9.2 משתני סביבה — Optional

```env
PORT=3000

# Oracle Integration
ORACLE_ENABLED=true|false
ORACLE_USER=qc_user
ORACLE_PASSWORD=qc_pass
ORACLE_CONNECT_STRING=db-host:1521/qc_service

# QC Module
QC_ENABLED=true|false
```

### 9.3 קובץ .env לפיתוח

```env
JWT_SECRET=dev-secret-change-in-production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nightops
PORT=3000
ORACLE_ENABLED=false
QC_ENABLED=false
```

---

## 10. מה נשאר להשלים

### 10.1 בעדיפות גבוהה

| פריט | תיאור |
|------|-------|
| **QC Integration — CR Items** | חיבור אמיתי ל-Oracle לשליפת CRs לפי גרסה |
| **QC Integration — Test Coverage** | שאילתות כיסוי בדיקות בזמן אמת |
| **Email Delivery** | שליחת דוחות סיכום בדואר אלקטרוני (מודל EmailRecipient מוגדר, שליחה לא ממומשת) |
| **Token Refresh** | JWT אין מנגנון refresh — תפוגה גורמת להתנתקות ללא אזהרה |

### 10.2 בעדיפות בינונית

| פריט | תיאור |
|------|-------|
| **Structured Logging** | החלפת console.log בשירות logging מובנה (Winston/Pino) |
| **CORS Production** | כרגע hardcoded לפיתוח בלבד — נדרש תצורה לייצור |
| **Session Timeout** | אין timeout אוטומטי ל-JWT בצד הלקוח |
| **Pagination** | רוב ה-endpoints מחזירים הכל ללא pagination |
| **File Size Limit** | אין הגבלת גודל לקבצי Excel המועלים |

### 10.3 בעדיפות נמוכה

| פריט | תיאור |
|------|-------|
| **Mobile Responsiveness** | ממשק מותאם בעיקר לדסקטופ |
| **Notifications** | Push notifications / email alerts על אירועים |
| **Reports Dashboard** | BI/analytics על ביצועים היסטוריים |
| **Multi-language** | ממשק בעברית בלבד |
| **Dark Mode** | אין תמיכה ב-dark mode |
| **PII in Code** | רשימת עובדים hardcoded ב-users.service.ts — לעבור ל-DB |

---

*תיק זה נוצר בתאריך מאי 2026 ומשקף את מצב המערכת בגרסה זו.*
