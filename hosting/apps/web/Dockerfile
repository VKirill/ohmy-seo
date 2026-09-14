# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Cache mount keeps rebuilds fast without baking the npm cache into a layer.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3300 HOSTNAME=0.0.0.0
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
# `output: standalone` ships only the files actually imported, so the runtime
# image carries no build toolchain and no dev dependencies.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# standalone does not bundle public/ — the sync client tarball lives there.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3300/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
