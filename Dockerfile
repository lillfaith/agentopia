# syntax=docker/dockerfile:1
# Agentopia — one image, three roles (AGENTOPIA_ROLE=all | api | worker).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional: behind a TLS-inspecting proxy, pass its CA with
#   docker build --secret id=build_ca,src=/path/to/ca.crt ...
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    AGENTOPIA_DB_PATH=/data/agentopia.sqlite \
    AGENTOPIA_ROLE=all \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY tsconfig.json ./
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node_modules/.bin/tsx", "server/healthcheck.ts"]
# Single-town mode: binding to 0.0.0.0 REQUIRES AGENTOPIA_ADMIN_TOKEN (or _FILE). SaaS mode (AGENTOPIA_MODE=saas) uses user sessions instead.
CMD ["node_modules/.bin/tsx", "server/index.ts"]
