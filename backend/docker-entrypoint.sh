#!/bin/sh
set -e
echo "[DeployCenter] Running DB migrations..."
# Use direct path — avoids npx touching the registry in offline environments
/app/node_modules/.bin/prisma migrate deploy
echo "[DeployCenter] Starting server..."
exec node dist/src/main.js
