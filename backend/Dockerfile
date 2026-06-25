FROM node:20-slim AS builder
WORKDIR /app
# node:20-slim is Debian Bookworm — install OpenSSL so Prisma can detect the version
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim
WORKDIR /app
# Prisma query engine (.so.node) links dynamically against libssl — must be present at runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/package.json ./
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV NODE_ENV=prod
# Prevent any runtime downloads — use the embedded library engine only
ENV PRISMA_QUERY_ENGINE_TYPE=library
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
