#!/bin/bash
# ============================================================
# DeployCenter 2.8.1 — Build Release Package
# מריץ את זה על מחשב הפיתוח (לא על שרת הייצור)
# ============================================================
# פלט: deploycenter-docker-v2.8.1.tar
#       (כולל images: deploycenter-api:2.8.1 + deploycenter-frontend:2.8.1 + postgres:16-alpine)
# ============================================================

set -e

VERSION="2.8.1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$REPO_ROOT/release-v${VERSION}"
TAR_NAME="deploycenter-docker-v${VERSION}.tar"

echo ""
echo "======================================================"
echo " DeployCenter v${VERSION} — Build Release"
echo " Root: $REPO_ROOT"
echo "======================================================"
echo ""

# ── Build backend image ──────────────────────────────────
echo "[1/5] Building backend image (deploycenter-api:${VERSION})..."
docker build \
  -t "deploycenter-api:${VERSION}" \
  "$REPO_ROOT/backend"
echo "      Backend image OK"

# ── Build frontend image ─────────────────────────────────
echo "[2/5] Building frontend image (deploycenter-frontend:${VERSION})..."
docker build \
  -t "deploycenter-frontend:${VERSION}" \
  "$REPO_ROOT/frontend"
echo "      Frontend image OK"

# ── Pull postgres (if not already present) ───────────────
echo "[3/5] Pulling postgres:16-alpine (if needed)..."
docker pull postgres:16-alpine
echo "      postgres:16-alpine OK"

# ── Export data from dev DB ──────────────────────────────
echo "[4/5] Exporting users/teams/templates from dev DB..."
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
echo "[5/5] Saving images to $RELEASE_DIR/$TAR_NAME ..."
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
echo "   scp $RELEASE_DIR/* user@SERVER:/tmp/deploycenter-2.8.1/"
echo "   ssh user@SERVER 'cd /tmp/deploycenter-2.8.1 && sudo bash install-docker.sh'"
echo "======================================================"
