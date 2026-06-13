# NightOps v2 — Production Installation Guide

**Release:** v2.2.0 (2026-06-13)  
**Commit:** b5dd1864

---

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Docker Engine | 24+ |
| Docker Compose | v2.24+ (plugin syntax `docker compose`) |
| RAM | 4 GB |
| Disk | 20 GB free |

All other dependencies (Node.js, Postgres, Nginx) run inside Docker — nothing to install on the host.

---

## Step 1 — Clone the repository

```bash
git clone <your-repo-url> nightops
cd nightops
git checkout v2.2.0
```

---

## Step 2 — Configure production secrets

Edit `backend/.env.prod`. Replace every `CHANGE_ME` placeholder:

```env
# Postgres password (must match POSTGRES_PASSWORD below or use the docker default)
DATABASE_URL="postgresql://nightops_user:CHANGE_ME@postgres-prod:5432/nightops_prod"

# Generate: openssl rand -hex 32
JWT_SECRET="CHANGE_ME_use_openssl_rand_hex_32"

PORT=3010
NODE_ENV=prod

# Web-push (push notifications) — generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY="CHANGE_ME"
VAPID_PRIVATE_KEY="CHANGE_ME"
VAPID_EMAIL="mailto:admin@yourcompany.com"

# Oracle (optional BI integration)
ORACLE_ENABLED=false
ORACLE_USER=
ORACLE_PASSWORD=
ORACLE_CONNECT_STRING=
```

> **Note:** The `DATABASE_URL` host must be `postgres-prod` (the Docker service name), not `localhost`.

### Optional — custom Postgres password

Create a `.env` file next to `docker-compose.yml`:

```env
POSTGRES_PASSWORD=your_strong_db_password
```

And update `DATABASE_URL` in `.env.prod` to match.

### Optional — CR Excel files path

If you use the CR import feature, mount the Excel folder:

```env
# In .env next to docker-compose.yml:
CR_FILES_PATH=/opt/cr_files
```

---

## Step 3 — Configure frontend API URL

If the frontend will be accessed from a hostname other than `localhost` (i.e. production server IP or domain), update the build arg in `docker-compose.yml`:

```yaml
frontend-prod:
  build:
    args:
      REACT_APP_API_URL: "http://YOUR_SERVER_IP_OR_DOMAIN:3010"
```

---

## Step 4 — Start the stack

```bash
docker compose --profile prod up -d --build
```

This starts:
- `nightops-postgres-prod` on port **5434**
- `nightops-backend-prod` on port **3010**
- `nightops-frontend-prod` (nginx) on port **3011**
- `nightops-redis` on port **6379**

Check all containers are running:

```bash
docker compose --profile prod ps
```

---

## Step 5 — Initialize the database

Run Prisma migrations (first time only):

```bash
docker exec nightops-backend-prod npx prisma db push --schema=./prisma/schema.prisma
```

---

## Step 6 — Seed initial data

### 6a — Create the admin user

```bash
docker exec -it nightops-postgres-prod psql -U nightops_user -d nightops_prod
```

Inside psql, paste:

```sql
-- Replace the hash below with bcrypt hash of your chosen password
-- Generate: node -e "const b=require('bcrypt');b.hash('YourPassword!',10).then(h=>console.log(h))"
INSERT INTO "User" (id, email, name, role, "passwordHash", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'admin@yourcompany.com',
  'מנהל מערכת',
  'ADMIN',
  '$2b$10$REPLACE_WITH_REAL_BCRYPT_HASH',
  true,
  NOW(),
  NOW()
);
\q
```

### 6b — Seed skills

```bash
docker exec -it nightops-postgres-prod psql -U nightops_user -d nightops_prod
```

```sql
INSERT INTO "Skill" (id, name, type, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'שיווק',           'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'מכירות',          'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'התקנה',           'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'שירות ותמיכה',   'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'חיוב ובלינג',    'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'ניתוק',          'Business',     NOW(), NOW()),
  (gen_random_uuid(), 'אינטרנט',        'Professional', NOW(), NOW()),
  (gen_random_uuid(), 'טלוויזיה',       'Professional', NOW(), NOW()),
  (gen_random_uuid(), 'טלפון נייח',     'Professional', NOW(), NOW()),
  (gen_random_uuid(), 'חשמל',           'Professional', NOW(), NOW()),
  (gen_random_uuid(), 'באנדלים',        'Professional', NOW(), NOW())
ON CONFLICT DO NOTHING;
\q
```

---

## Step 7 — Verify

```bash
# Backend health
curl http://localhost:3010/health

# Frontend
curl -I http://localhost:3011
```

Open `http://YOUR_SERVER:3011` in a browser and log in.

---

## Step 8 — LDAP / Active Directory (optional)

LDAP can be enabled from the AdminPanel after first login:

1. Log in as admin → **ניהול** → **AdminPanel** → tab **LDAP**.
2. Fill in: `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_SEARCH_BASE`.
3. Toggle **LDAP_ENABLED** to `true`.

---

## Upgrade procedure

```bash
git pull
git checkout <new-tag>
docker compose --profile prod up -d --build
docker exec nightops-backend-prod npx prisma db push --schema=./prisma/schema.prisma
```

---

## Firewall Rules

### Ports opened on the production server

| Port | Protocol | Service | Direction | Allow from |
|---|---|---|---|---|
| **3011** | TCP | Frontend (nginx) | Inbound | User workstations / office network |
| **3010** | TCP | Backend API | Inbound | Frontend server only (same host → `127.0.0.1`) |
| **5434** | TCP | Postgres | **BLOCK** external | Internal Docker network only |
| **6379** | TCP | Redis | **BLOCK** external | Internal Docker network only |

### Minimal FW rule set (Linux `ufw` example)

```bash
# Allow users to reach the frontend
ufw allow from <OFFICE_SUBNET>/24 to any port 3011 proto tcp

# Backend API: only localhost (frontend is on same host)
# If frontend and backend are on the SAME server, no rule needed — docker bridge handles it.
# If on separate servers, allow backend from frontend server's IP only:
ufw allow from <FRONTEND_SERVER_IP> to any port 3010 proto tcp

# Deny everything else on these ports from outside
ufw deny 5434
ufw deny 6379
ufw deny 3010  # (if not opened above)
```

### Windows Firewall (if running on Windows Server)

```powershell
# Allow frontend from office network
New-NetFirewallRule -DisplayName "NightOps Frontend" -Direction Inbound `
  -Protocol TCP -LocalPort 3011 -Action Allow `
  -RemoteAddress <OFFICE_SUBNET>

# Block DB and Redis from all external
New-NetFirewallRule -DisplayName "Block Postgres Prod" -Direction Inbound `
  -Protocol TCP -LocalPort 5434 -Action Block
New-NetFirewallRule -DisplayName "Block Redis" -Direction Inbound `
  -Protocol TCP -LocalPort 6379 -Action Block
```

### Summary table (for FW request ticket)

```
Application : NightOps Operations System
Server      : <PROD_SERVER_IP>

OPEN  TCP 3011  inbound  from <OFFICE_NETWORK>  → Frontend UI (nginx)
CLOSE TCP 3010  external (backend, internal only)
CLOSE TCP 5434  external (PostgreSQL, Docker internal)
CLOSE TCP 6379  external (Redis, Docker internal)
```

---

## Useful operational commands

```bash
# View live logs
docker compose --profile prod logs -f backend-prod
docker compose --profile prod logs -f frontend-prod

# Restart a single service
docker compose --profile prod restart backend-prod

# Stop everything
docker compose --profile prod down

# Full wipe (WARNING: deletes DB data)
docker compose --profile prod down -v
```
