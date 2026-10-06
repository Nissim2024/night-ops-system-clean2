#!/bin/sh
# DeployCenter frontend — runtime setup, run by the nginx image's entrypoint
# (/docker-entrypoint.d) on every container start (2026-10-06).
#
# 1. DC_ENV (prod | test) -> /env-config.js, read by the app (runtimeEnv.ts),
#    so one image serves both the production and the test environment.
# 2. HTTPS, opt-in: when /etc/nginx/certs/server.crt + server.key are mounted,
#    serve 443 with them and redirect plain HTTP to HTTPS. Without them the
#    server stays HTTP only, exactly as before.
#      DC_PUBLIC_HTTPS_PORT — the HTTPS port users type (default 443); used in
#                             the redirect when it isn't 443 (e.g. test: 8443)
set -e

HTML=/usr/share/nginx/html
CONF=/etc/nginx/conf.d/default.conf
CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key

ENV_NAME="${DC_ENV:-prod}"
printf 'window.__DC_ENV = "%s";\n' "$ENV_NAME" > "$HTML/env-config.js"
echo "dc-runtime: environment = $ENV_NAME"

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  PORT_SUFFIX=""
  if [ -n "${DC_PUBLIC_HTTPS_PORT:-}" ] && [ "$DC_PUBLIC_HTTPS_PORT" != "443" ]; then
    PORT_SUFFIX=":$DC_PUBLIC_HTTPS_PORT"
  fi
  cat > "$CONF" <<EOF
server {
    listen 80;
    server_name _;
    return 301 https://\$host${PORT_SUFFIX}\$request_uri;
}

server {
    listen 443 ssl;
    server_name _;
    ssl_certificate     $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    add_header Strict-Transport-Security "max-age=31536000" always;

    include /etc/nginx/dc-locations.conf;
}
EOF
  echo "dc-runtime: HTTPS enabled (certificate found), HTTP redirects to HTTPS"
else
  cat > "$CONF" <<'EOF'
server {
    listen 80;
    server_name _;
    include /etc/nginx/dc-locations.conf;
}
EOF
  echo "dc-runtime: HTTP only (no certificate in /etc/nginx/certs)"
fi
