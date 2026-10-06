FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG REACT_APP_API_URL=/api
ARG REACT_APP_ENV=prod
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_ENV=$REACT_APP_ENV
RUN npm run build

FROM nginx:1.26-alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# runtime setup (2026-10-06): env marker + opt-in HTTPS — see docker/40-dc-runtime.sh
COPY docker/dc-locations.conf /etc/nginx/dc-locations.conf
COPY docker/40-dc-runtime.sh /docker-entrypoint.d/40-dc-runtime.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-dc-runtime.sh /etc/nginx/dc-locations.conf && chmod +x /docker-entrypoint.d/40-dc-runtime.sh
EXPOSE 80 443
