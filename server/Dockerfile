# ==========================================================
# Buchat — Backend Node.js
# ==========================================================
FROM node:22-alpine AS base

# Outils réseau pour healthcheck
RUN apk add --no-cache curl tini

WORKDIR /app

# Install deps (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy sources
COPY src ./src
COPY sql ./sql

# Copy statics (web-preview + website) — montés depuis le parent
# On les laisse montables en volume pour mise à jour rapide en prod
RUN mkdir -p /srv/web-preview /srv/website

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
