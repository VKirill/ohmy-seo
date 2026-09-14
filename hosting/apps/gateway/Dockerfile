# syntax=docker/dockerfile:1.7
ARG OHMY_SEO_REF=v0.9.3

# ---------------------------------------------------------------------------
# The MCP servers are built from source inside the image. Nothing on the host
# is required, so the stack drops onto a bare VPS with only Docker installed.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS ohmy
ARG OHMY_SEO_REF
WORKDIR /opt
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${OHMY_SEO_REF}" https://github.com/VKirill/ohmy-seo.git ohmy-seo
WORKDIR /opt/ohmy-seo
ENV CI=true
RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm -r build \
    && rm -rf .git

FROM node:24-bookworm-slim AS gwdeps
WORKDIR /gw
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM gwdeps AS gwbuild
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:24-bookworm-slim AS runner
WORKDIR /gw
ENV NODE_ENV=production PORT=3301 OHMY_SEO_ROOT=/opt/ohmy-seo TENANT_ROOT=/data/tenants
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m gateway \
    && mkdir -p /data/tenants && chown -R gateway:nodejs /data
COPY --from=ohmy    /opt/ohmy-seo   /opt/ohmy-seo
COPY --from=gwdeps  /gw/node_modules ./node_modules
COPY --from=gwbuild /gw/dist         ./dist
COPY package.json package-lock.json ./
USER gateway
EXPOSE 3301
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3301/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
