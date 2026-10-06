#!/bin/bash
# ============================================================
# DeployCenter 2.10.10 — Build Release Package
# מריץ את זה על מחשב הפיתוח (לא על שרת הייצור)
# ============================================================
# פלט: deploycenter-docker-v2.10.10.tar
#       (כולל images: deploycenter-api:2.10.10 + deploycenter-frontend:2.10.10 + postgres:16-alpine)
# ============================================================

set -e

VERSION="2.10.10"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$REPO_ROOT/release-v${VERSION}"
TAR_NAME="deploycenter-docker-v${VERSION}.tar"

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} — Build Release"
echo " Root: $REPO_ROOT"
echo "======================================================"
echo ""

# ── Ensure .env.template exists (blocked from the editor tooling) ─────────
# The .env.* files can't be authored by the release-prep tooling, so carry
# the previous release's template forward if this folder doesn't have one.
if [ ! -f "$RELEASE_DIR/.env.template" ]; then
  PREV_TMPL=$(ls -d "$REPO_ROOT"/release-v*/.env.template 2>/dev/null | sort -V | tail -1)
  if [ -n "$PREV_TMPL" ]; then
    cp "$PREV_TMPL" "$RELEASE_DIR/.env.template"
    echo "[0/6] .env.template carried over from $(dirname "$PREV_TMPL" | xargs basename)"
  else
    echo "[0/6] WARN: no .env.template found in any release-v* folder"
  fi
fi

# ── Sync package.json versions ───────────────────────────
# v2.8.7 shipped with images tagged 2.8.7 but backend/frontend package.json
# still saying 2.8.6 inside the containers, because this step didn't exist —
# only the deploy-wrapper files (this script itself) were sed-replaced, never
# the actual package.json before `docker build` ran. This makes it
# impossible to forget again.
echo "[1/6] Syncing backend/frontend package.json to ${VERSION}..."
(cd "$REPO_ROOT/backend" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
(cd "$REPO_ROOT/frontend" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
echo "      package.json OK"

# ── Build backend image ──────────────────────────────────
echo "[2/6] Building backend image (deploycenter-api:${VERSION})..."
docker build \
  -t "deploycenter-api:${VERSION}" \
  "$REPO_ROOT/backend"
echo "      Backend image OK"

# ── Build frontend image ─────────────────────────────────
echo "[3/6] Building frontend image (deploycenter-frontend:${VERSION})..."
docker build \
  -t "deploycenter-frontend:${VERSION}" \
  "$REPO_ROOT/frontend"
echo "      Frontend image OK"

# ── Migration gate (2026-10-06) ──────────────────────────
# Stops the build if any migration would not reach / apply in production:
# schema without migration, image missing a migration, upgrade from the
# previous release image failing, or a clean install failing.
echo "[3b/6] Verifying migrations (schema / image / upgrade / clean install)..."
bash "$REPO_ROOT/deploy/verify-migrations.sh" "$VERSION"
echo "      Migrations OK"

# ── Pull postgres (if not already present) ───────────────
echo "[4/6] Pulling postgres:16-alpine (if needed)..."
docker pull postgres:16-alpine
echo "      postgres:16-alpine OK"

# ── Export data from dev DB ──────────────────────────────
echo "[5/6] Exporting users/teams/templates from dev DB..."
cd "$REPO_ROOT/backend"
if NODE_ENV=dev npx ts-node scripts/export-data.ts "$RELEASE_DIR/deploycenter-data-export.json"; then
  echo "      Data export OK"
else
  echo "      [WARN] Data export failed — dev DB may not be running."
  echo "             Continue without data export? (Ctrl+C to abort, Enter to continue)"
  read -r
fi
cd "$REPO_ROOT"

# ── Save to tar ──────────────────────────────────────────
echo "[6/6] Saving images to $RELEASE_DIR/$TAR_NAME ..."
echo "      (יכול לקחת כמה דקות...)"
docker save \
  "deploycenter-api:${VERSION}" \
  "deploycenter-frontend:${VERSION}" \
  "postgres:16-alpine" \
  -o "$RELEASE_DIR/$TAR_NAME"

echo ""
ls -lh "$RELEASE_DIR/$TAR_NAME"

echo ""
echo "======================================================"
echo " Release ready: $RELEASE_DIR"
ls -1 "$RELEASE_DIR"
echo ""
echo " העבר לשרת RHEL:"
echo "   scp $RELEASE_DIR/* user@SERVER:/tmp/deploycenter-2.10.10/"
echo "   ssh user@SERVER 'cd /tmp/deploycenter-2.10.10 && sudo bash install-docker.sh'"
echo "======================================================"
