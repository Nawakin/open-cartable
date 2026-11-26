FROM node:24-bookworm-slim AS secrets
COPY --chmod=0444 deploy/generate-secrets.mjs /generate-secrets.mjs
CMD ["node", "/generate-secrets.mjs"]

FROM postgres:16-bookworm AS database-role
COPY --chmod=0444 deploy/create-db-role.sql /create-db-role.sql

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY apps/mobile/ apps/mobile/
RUN npm run build:web

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/mobile/package.json apps/mobile/
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --workspace @open-cartable/api --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node apps/api/ apps/api/
COPY --chown=node:node deploy/installation-link.mjs deploy/
COPY --from=web --chown=node:node /app/apps/mobile/dist/ apps/mobile/dist/
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 3000
CMD ["node", "apps/api/server.js"]
