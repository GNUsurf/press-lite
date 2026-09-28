# syntax=docker/dockerfile:1

# --- build: install everything, render the site, drop dev deps ---------------
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends make python3 g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Railway passes service variables as build args when declared here.
ARG SITE_URL=https://example.invalid
ENV SITE_URL=$SITE_URL
RUN make build && npm prune --omit=dev

# --- litestream binary --------------------------------------------------------
FROM litestream/litestream:0.3.13 AS litestream

# --- runtime ------------------------------------------------------------------
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json site.config.js litestream.yml ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node content ./content
COPY --chown=node:node public ./public
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint /app/scripts/restore.sh
USER node
EXPOSE 3000
ENTRYPOINT ["entrypoint"]
