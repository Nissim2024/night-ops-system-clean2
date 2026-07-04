# DeployCenter Backend — Dockerfile
# Supports Oracle Thick Mode (required for Oracle 11g, 12c, 19c).
# Oracle Client libraries are NOT bundled — they must be mounted as a volume.
# See: deployment/ORACLE-THICK-MODE.md

FROM node:20-slim AS builder
WORKDIR /app

# OpenSSL is required for Prisma query engine detection during build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
# nest build compiles src/ + scripts/ (tsconfig.build.json has no include restriction)
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Runtime deps:
#   openssl  — Prisma query engine (.so.node) links against libssl
#   libaio1  — Required by Oracle Client on Linux (Instant Client 19c)
RUN apt-get update -y \
 && apt-get install -y openssl libaio1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/package.json ./
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=prod
# Prevent Prisma from downloading engines at runtime (offline deployments)
ENV PRISMA_QUERY_ENGINE_TYPE=library
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# Oracle Thick Mode: mount the Oracle Client lib dir to /oracle/lib and set this var.
# Example docker-compose volume: /DeployCenter/oracle/product/19.0.0/client_1/lib:/oracle/lib:ro
# If not set, Oracle Thick Mode is disabled (Oracle 11g will NOT work without this).
ENV ORACLE_LIB_DIR=""

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
