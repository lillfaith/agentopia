# Agentopia — one image, three roles (AGENTOPIA_ROLE=all | api | worker).
# The official Node image, pulled from its AWS mirror: Docker Hub rate-limits the shared
# builders that Railway and CI use (429 Too Many Requests).

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    AGENTOPIA_DB_PATH=/data/agentopia.sqlite \
    AGENTOPIA_ROLE=all \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY tsconfig.json ./
# State lives in /data. Mount a volume there (docker compose: a named volume;
# Railway: a service volume; the platform attaches it, so no VOLUME line here).
# The entrypoint fixes the volume's ownership, then runs everything as the 'node' user.
RUN mkdir -p /data && chown -R node:node /data
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node_modules/.bin/tsx", "server/healthcheck.ts"]
# Runs migrations, then the server. On Railway (detected from its RAILWAY_* variables) the
# app defaults to SaaS mode with data in /data. Elsewhere it is a single town, which on
# 0.0.0.0 REQUIRES AGENTOPIA_ADMIN_TOKEN (or _FILE); set AGENTOPIA_MODE=saas for multi-user.
CMD ["sh", "scripts/start.sh"]
