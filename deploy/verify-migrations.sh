#!/bin/bash
# ============================================================
# DeployCenter — migration gate for a release build
#   usage: deploy/verify-migrations.sh <version>     (e.g. 2.10.10)
# Run by release-v*/build-release.sh after the images are built and BEFORE
# the tar is saved: any failure stops the build, so a package whose
# migrations would not apply in production is never produced (user ask
# 2026-10-06, after the 2.10.1 missing-migration incident).
#
# Checks, on a throwaway postgres container (never the dev/test DBs):
#   1. schema.prisma has no change without a migration (migration chain ==
#      schema, via a shadow DB)
#   2. the API image carries exactly the repo's migrations, same contents
#   3. upgrade path: a DB migrated by the previous release image, then
#      migrated by the new image -> succeeds, "up to date", and the result
#      equals schema.prisma
#   4. clean install: the new image migrates an empty DB from scratch
# ============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /app/... paths as-is

VERSION="${1:?usage: verify-migrations.sh <version>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="deploycenter-api:${VERSION}"
PG=dc-migcheck-$$
PORT=55439
PGURL_HOST="postgresql://mig:mig@localhost:${PORT}"
PGURL_CONT="postgresql://mig:mig@host.docker.internal:${PORT}"
PRISMA="/app/node_modules/.bin/prisma"

fail() { echo "      ❌ MIGRATION GATE FAILED: $*"; exit 1; }
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "      starting throwaway postgres ($PG on :$PORT)..."
docker run -d --rm --name "$PG" -p ${PORT}:5432 -e POSTGRES_USER=mig -e POSTGRES_PASSWORD=mig -e POSTGRES_DB=mig postgres:16-alpine >/dev/null
for i in $(seq 1 60); do docker exec "$PG" pg_isready -U mig >/dev/null 2>&1 && break; sleep 1; done
sleep 2
mkdb() { docker exec "$PG" psql -U mig -d mig -qc "CREATE DATABASE $1;" >/dev/null; }
mkdb shadow1; mkdb upgrade; mkdb fresh

cd "$REPO_ROOT/backend"

# 1. schema vs migration chain
out=$(npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
      --shadow-database-url "$PGURL_HOST/shadow1" --script 2>&1) || fail "migrate diff error: $out"
echo "$out" | grep -q "This is an empty migration" || { echo "$out" | head -30; fail "schema.prisma has changes with NO migration (see SQL above)"; }
echo "      [1/4] schema == migrations ✓"

# 2. image carries the repo's migrations, byte-identical
repo_list=$(ls ./prisma/migrations | sort)
img_list=$(docker run --rm --entrypoint sh "$IMAGE" -c "ls /app/prisma/migrations | sort")
[ "$repo_list" = "$img_list" ] || fail "image migration list differs from the repo"
repo_sums=$(cd ./prisma/migrations && for d in */; do printf '%s %s\n' "$d" "$(tr -d '\r' < "$d/migration.sql" | md5sum | cut -d' ' -f1)"; done)
img_sums=$(docker run --rm --entrypoint sh "$IMAGE" -c 'cd /app/prisma/migrations && for d in */; do printf "%s %s\n" "$d" "$(tr -d "\r" < "$d/migration.sql" | md5sum | cut -d" " -f1)"; done')
[ "$repo_sums" = "$img_sums" ] || fail "a migration.sql inside the image differs from the repo"
echo "      [2/4] image has all $(echo "$repo_list" | grep -vc toml) migrations, identical ✓"

# 3. upgrade from the previous release image (what production runs)
PREV=$(docker image ls --format '{{.Tag}}' deploycenter-api | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | awk -v v="$VERSION" '$0 != v' | awk -v v="$VERSION" 'BEGIN{split(v,a,".")} {split($0,b,"."); if (b[1]<a[1] || (b[1]==a[1] && (b[2]<a[2] || (b[2]==a[2] && b[3]<a[3])))) print}' | tail -1)
if [ -n "$PREV" ]; then
  docker run --rm -e DATABASE_URL="$PGURL_CONT/upgrade" --entrypoint sh "deploycenter-api:$PREV" -c "$PRISMA migrate deploy" >/dev/null 2>&1 \
    || fail "previous image $PREV could not migrate an empty DB (baseline)"
  up=$(docker run --rm -e DATABASE_URL="$PGURL_CONT/upgrade" --entrypoint sh "$IMAGE" -c "$PRISMA migrate deploy" 2>&1) \
    || { echo "$up" | tail -20; fail "upgrade $PREV -> $VERSION failed"; }
  applied=$(echo "$up" | grep -oE '^\s+└─ [0-9A-Za-z_]+/' | sed 's/[ └─/]//g' | tr '\n' ' ')
  st=$(docker run --rm -e DATABASE_URL="$PGURL_CONT/upgrade" --entrypoint sh "$IMAGE" -c "$PRISMA migrate status" 2>&1) || true
  echo "$st" | grep -q "Database schema is up to date" || { echo "$st" | tail -10; fail "after upgrade the DB is not up to date"; }
  d=$(npx prisma migrate diff --from-url "$PGURL_HOST/upgrade" --to-schema-datamodel ./prisma/schema.prisma --script 2>&1)
  echo "$d" | grep -q "This is an empty migration" || { echo "$d" | head -30; fail "upgraded DB does not match schema.prisma"; }
  echo "      [3/4] upgrade $PREV -> $VERSION applied: ${applied:-none} ✓"
else
  echo "      [3/4] no previous deploycenter-api image found locally — upgrade check skipped"
fi

# 4. clean install
docker run --rm -e DATABASE_URL="$PGURL_CONT/fresh" --entrypoint sh "$IMAGE" -c "$PRISMA migrate deploy" >/dev/null 2>&1 \
  || fail "clean install: migrate deploy on an empty DB failed"
echo "      [4/4] clean install migrates from scratch ✓"
cd "$REPO_ROOT"
