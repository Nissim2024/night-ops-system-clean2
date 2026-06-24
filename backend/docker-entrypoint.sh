#!/bin/sh
set -e
echo "[DeployCenter] Running DB migrations..."
npx prisma migrate deploy
echo "[DeployCenter] Starting server..."
exec node dist/src/main.js
