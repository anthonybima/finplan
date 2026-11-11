# FinPlan website: build the hardened web bundle, then serve it with Caddy (automatic HTTPS + security headers).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not ci): package.json pins the official SheetJS 0.20.3 tarball (cdn.sheetjs.com), newer than the lock file.
# The website needs no desktop/phone shells: skip Electron's binary download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install --no-audit --no-fund
COPY . .
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build:web

FROM caddy:2-alpine
COPY --from=build /app/dist-web /srv/finplan
COPY --from=build /app/deploy/Caddyfile.docker /etc/caddy/Caddyfile
EXPOSE 80 443 443/udp
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:2019/config/ >/dev/null || exit 1
