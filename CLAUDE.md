# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NightOps is a bilingual (Hebrew/English) SaaS platform for managing software release nights. It coordinates teams, tasks, CR (Change Request) plans, schedules, rehearsals, and real-night execution across multiple teams with real-time collaboration.

## Commands

### Backend (`/backend`)
```bash
npm run start          # Dev mode with hot-reload (NODE_ENV=dev, port 3000)
npm run start:test     # Test environment backend (NODE_ENV=test)
npm run build          # Compile TypeScript
npm run lint           # ESLint with auto-fix
npm test               # Jest unit tests
npm run test:watch     # Jest in watch mode
npm run test:cov       # Coverage report

# Database
npm run db:dev         # Start dev Postgres via Docker (port 5432)
npm run db:test        # Start test Postgres via Docker (port 5433)
npm run migrate:dev    # Run Prisma migrations (dev)
npm run push:dev       # Push schema without migration (dev)
npx prisma studio      # Open Prisma Studio GUI
```

### Frontend (`/frontend`)
```bash
npm start              # Dev server on port 3001 (REACT_APP_API_URL defaults to :3000)
npm run start:test     # Dev server on port 3002, API at :3001, REACT_APP_ENV=test
npm run build          # Production build
npm test               # React Testing Library tests
```

### E2E Tests (`/playwright-tests`)
```bash
npx playwright test                    # Run all tests headless
npx playwright test qa-recent-changes  # Run specific suite
npx playwright show-report             # Open HTML report in /report
```

## Architecture

### Stack
- **Backend**: NestJS 11, Prisma 5 (PostgreSQL), Socket.io, JWT auth, bcrypt, nodemailer, docx
- **Frontend**: React 19, TypeScript, axios, socket.io-client, MUI (icons only), inline styles via design tokens
- **DB**: PostgreSQL 16 (Docker), three profiles: dev(:5432), test(:5433), prod(:5434)

### Backend structure

Each feature is a self-contained NestJS module: `module.ts` → `controller.ts` → `service.ts`. Every service instantiates its own `new PrismaClient()` directly — there is no shared Prisma provider/module.

Key modules and their responsibilities:
- **versions** — the core domain; manages the full `VersionStatus` state machine (DRAFT → CR_REVIEW → COLLECTING → REFINING → REVIEW → APPROVED → REHEARSAL → ACTIVE → MORNING_AFTER → COMPLETED). Also owns Phase/SubPhase/Task CRUD, the reschedule wizard, and employee reassignment.
- **tasks** — task status transitions (WAITING/OPEN/IN_PROGRESS/BLOCKED/DONE/FAILED/ROLLED_BACK), audit logging, phase-gate enforcement
- **import** — parses color-coded Excel files (xlsx) to create versions with phases/tasks; also fetches CR lists from QC release assignments
- **auth** — JWT login (bcrypt local + optional LDAP/AD via ldapts). Three hardcoded local accounts bypass LDAP: `nissim@test.com`, `nisim@dev.com`, `hay@dev.com`
- **summary** — generates Word (.docx) night/rehearsal summary reports; sends via SMTP nodemailer; email settings stored in SystemParams table
- **events** — Socket.io gateway; broadcasts `TASK_UPDATED`, `TASK_BLOCKED`, `GO_DECISION`, `VERSION_UPDATED`, `USER_ONLINE/OFFLINE`
- **cr-plans** — team-level CR execution plans (what each team will do per CR), with manager approval flow
- **task-proposals** — team-lead CR task proposals (DRAFT → READY), converted to actual tasks by managers
- **version-cr-assignments** — syncs CR list from QcRelease to a version; resolved by team via `fetchCrsForTeam`
- **system-params** — key-value store for runtime config (EMAIL_*, LDAP_*, etc); seeded on startup

Auth roles (enforced in controllers via inline `requireRole()`):
- `ADMIN` — full access
- `RELEASE_MANAGER` — version management, approvals, summary
- `TEAM_LEAD` — submit for own team, task proposals, task CRUD
- `EMPLOYEE` — task status updates (no cross-team check — known security gap)
- `VIEWER` — read-only

### Frontend structure

**Entry**: `App.tsx` → reads JWT from `localStorage('deploycenter_token')` → routes to `ManagerDashboard` (ADMIN/RELEASE_MANAGER/TEAM_LEAD) or `EmployeeDashboard` (EMPLOYEE/VIEWER).

**Design system**: All color values, fonts, and status helpers live in `theme.ts` (exported as `C`, `FONT`, `FONT_MONO`, `statusColor`, `statusBg`, `statusLabel`). All components use inline styles referencing these tokens — never hardcode hex. MUI is used only for icons.

**Feature flags**: `featureFlags.ts` — currently `TEAM_LEAD_PROPOSAL: true`, `CR_PLAN_HANDOFF: true`.

**ManagerDashboard** is the top-level shell for managers. It owns:
- Version selector filtered by `versionCategory`: active (ACTIVE/REHEARSAL/MORNING_AFTER) / inactive (everything else not archived) / archived (isArchived=true)
- Stage tabs: prep / handoff / timeline / night / summary / admin
- WebSocket connection via `useSocket` hook
- Real-time toast notifications and online-user presence

**Key screens**:
- `VersionsView` — version CRUD, wizard launch (`PlanWizard`), CR plan review panel
- `PlanWizard` — 5-step modal: (1) phase schedule/reschedule, (2) employee replacement, (3) auto-deps by user, (4) anomaly detection, (5) sort by planned start
- `CrHandoffView` — team-lead proposal submission and review (CR_REVIEW phase)
- `CrReviewView` — release manager CR approval view
- `TeamView` / `WarRoom` — live execution board (REHEARSAL/ACTIVE), sub-phase task grid, multi-select, GO/NO-GO
- `NightSummary` — summary approval, Word download, email send
- `TimelineView` — Gantt-like view of planned vs actual task times
- `AdminPanel` — user management, team management, system params (LDAP, email), permissions

**Real-time**: `useSocket` connects to the backend Socket.io server. Task updates, version status changes, and GO/NO-GO decisions propagate instantly to all connected clients.

**Permissions**: `PermissionsContext` loads per-role permission strings from `/permissions`. Use `can('permission_key')` throughout components; `RolePermissions` table is editable by ADMIN at runtime.

### Version lifecycle

The `VersionStatus` state machine is enforced server-side in `versions.service.ts`:

```
DRAFT → CR_REVIEW → COLLECTING → REFINING → REVIEW → APPROVED → REHEARSAL → ACTIVE → MORNING_AFTER → COMPLETED
```

- REHEARSAL can only exit via `POST /versions/:id/end-rehearsal` (not via status PATCH)
- COLLECTING→REFINING checks that all teams with CrPlans have submitted (bypassable with `force: true`)
- COMPLETED versions with `isArchived=false` appear in the "inactive" tab of ManagerDashboard and are not auto-selected

### Database env files

Backend loads `.env.{NODE_ENV}` (e.g. `.env.dev`, `.env.test`). The bare `.env` is a fallback pointing to dev DB.

### Known security issues (do not regress)

- `tasks.updateStatus()` and `tasks.update()` have no team-membership check — any authenticated user can update any task
- `GET /auth/config` is public (no JWT required)
- No rate limiting on `POST /auth/login` specifically (global throttler: 100 req/min per IP)
- 95 real employee emails are hardcoded in `users.service.ts` as `HARDCODED_QC_USERS` fallback
