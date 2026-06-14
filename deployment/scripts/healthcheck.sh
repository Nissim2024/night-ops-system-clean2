#!/usr/bin/env bash
# healthcheck.sh <slot> [retries] [interval]
# Returns 0 = healthy, 1 = unhealthy
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/nightops.conf"

SLOT="${1:-green}"
RETRIES="${2:-$HEALTH_RETRIES}"
INTERVAL="${3:-$HEALTH_INTERVAL}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
info() { echo -e "    $*"; }

if [ "$SLOT" = "blue" ]; then
  BACKEND_PORT=$BLUE_BACKEND_PORT
  FRONTEND_PORT=$BLUE_FRONTEND_PORT
else
  BACKEND_PORT=$GREEN_BACKEND_PORT
  FRONTEND_PORT=$GREEN_FRONTEND_PORT
fi

echo "── Health Check: slot=$SLOT backend=:$BACKEND_PORT frontend=:$FRONTEND_PORT ──"

# ── Backend /health ───────────────────────────────────────────────────────────
check_backend() {
  local attempt=0
  while [ $attempt -lt "$RETRIES" ]; do
    attempt=$((attempt + 1))
    local response
    response=$(curl -sf --max-time 5 "http://127.0.0.1:${BACKEND_PORT}/health" 2>/dev/null) && {
      local status db
      status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
      db=$(echo "$response"     | grep -o '"db":"[^"]*"'     | cut -d'"' -f4)
      if [ "$status" = "ok" ] && [ "$db" = "ok" ]; then
        ok "Backend /health → status=ok db=ok"
        return 0
      else
        warn "Backend responded but degraded: $response"
      fi
    } || warn "Backend not yet ready (attempt $attempt/$RETRIES)..."
    sleep "$INTERVAL"
  done
  err "Backend health check FAILED after $RETRIES attempts"
  return 1
}

# ── Frontend reachability ─────────────────────────────────────────────────────
check_frontend() {
  local attempt=0
  while [ $attempt -lt "$RETRIES" ]; do
    attempt=$((attempt + 1))
    local http_code
    http_code=$(curl -so /dev/null -w "%{http_code}" --max-time 5 \
      "http://127.0.0.1:${FRONTEND_PORT}/" 2>/dev/null) || true
    if [[ "$http_code" =~ ^(200|301|302)$ ]]; then
      ok "Frontend :$FRONTEND_PORT → HTTP $http_code"
      return 0
    fi
    warn "Frontend not ready (HTTP $http_code, attempt $attempt/$RETRIES)..."
    sleep "$INTERVAL"
  done
  err "Frontend health check FAILED"
  return 1
}

# ── Latency check ─────────────────────────────────────────────────────────────
check_latency() {
  local latency
  latency=$(curl -so /dev/null -w "%{time_total}" --max-time 10 \
    "http://127.0.0.1:${BACKEND_PORT}/health" 2>/dev/null) || latency="N/A"
  info "Backend response time: ${latency}s"
  # Warn if > 2s
  if command -v awk &>/dev/null && [ "$latency" != "N/A" ]; then
    if awk "BEGIN{exit !($latency > 2)}"; then
      warn "Backend response time > 2s — check server load"
    fi
  fi
}

# ── Run all checks ────────────────────────────────────────────────────────────
FAILED=0
check_backend || FAILED=1
check_frontend || FAILED=1

if [ $FAILED -eq 0 ]; then
  check_latency
  echo ""
  ok "Slot '$SLOT' is HEALTHY ✓"
  exit 0
else
  echo ""
  err "Slot '$SLOT' is UNHEALTHY ✗ — do NOT switch traffic"
  exit 1
fi
