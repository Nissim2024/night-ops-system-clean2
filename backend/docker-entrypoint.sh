#!/bin/sh
# DeployCenter — Docker Entrypoint
set -e

# Read from package.json (single source of truth — see health.controller.ts's
# APP_VERSION for the same fix applied to the /health endpoint) instead of a
# hardcoded literal here, which had drifted stale across releases before.
VERSION=$(node -e "console.log(require('/app/package.json').version)")

echo ""
echo "=================================================="
echo "  DeployCenter v${VERSION} — Starting"
echo "=================================================="

# ── Step 1: Run database migrations ────────────────────────────────────────
echo "[1/3] Running DB migrations..."
/app/node_modules/.bin/prisma migrate deploy
echo "      Migrations OK"

# ── Step 2: Seed / import data ─────────────────────────────────────────────
echo "[2/3] Checking data initialization..."

if [ -n "$SEED_DATA_FILE" ] && [ -f "$SEED_DATA_FILE" ]; then
  echo "      SEED_DATA_FILE found: $SEED_DATA_FILE"
  echo "      Importing existing data (users, teams, permissions, system params)..."
  node /app/dist/scripts/import-data.js "$SEED_DATA_FILE"
  echo "      Data import complete"
elif [ -n "$ADMIN_PASSWORD" ]; then
  echo "      No SEED_DATA_FILE — running default seed (admin user + permissions)"
  node /app/dist/scripts/seed-default.js
  echo "      Default seed complete"
else
  echo "      No SEED_DATA_FILE and no ADMIN_PASSWORD — skipping seed"
  echo "      (If this is a fresh install, set SEED_DATA_FILE or ADMIN_PASSWORD)"
fi

# ── Step 3: Start the application ──────────────────────────────────────────
echo "[3/3] Starting server..."
echo "=================================================="
echo ""
exec node /app/dist/src/main.js
