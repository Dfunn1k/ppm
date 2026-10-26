# Producción: se construye la web una vez y Caddy la sirve con HTTPS automático.
# Caddy también reenvía /api/… a la API (sin el prefijo), igual que Vite en desarrollo.
FROM node:22.18.0-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /web
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2.10.0-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /web/dist /srv
