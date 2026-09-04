# Build from the repository root: docker build -f packages/sinkhole/Dockerfile -t payhole-sinkhole .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @payhole/sinkhole... \
 && pnpm --filter @payhole/sdk build \
 && pnpm --filter @payhole/sinkhole build \
 && pnpm --filter @payhole/sinkhole deploy --prod --legacy /out

FROM node:24-alpine
# dnsmasq is the resolver; the agent renders its configuration and supervises it. No query logging is
# ever configured. The unprivileged user exists so dnsmasq can drop root after binding port 53.
RUN apk add --no-cache dnsmasq \
 && (getent passwd dnsmasq >/dev/null || adduser -S -D -H -s /sbin/nologin dnsmasq)
ENV NODE_ENV=production \
    DATA_DIR=/data \
    DNSMASQ_USER=dnsmasq \
    DNS_LISTEN=0.0.0.0 \
    DNS_PORT=53 \
    ADMIN_LISTEN=0.0.0.0 \
    ADMIN_PORT=8053 \
    SWARM_LISTEN=/ip4/0.0.0.0/tcp/4001
WORKDIR /app
COPY --from=build /out .
VOLUME ["/data"]
EXPOSE 53/udp 53/tcp 8053/tcp 4001/tcp 853/tcp 8054/tcp
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- "http://127.0.0.1:${ADMIN_PORT}/healthz" || exit 1
# The agent is PID 1: it spawns dnsmasq, handles SIGTERM, and restarts dnsmasq when the blocklist changes.
ENTRYPOINT ["node", "dist/main.js"]
CMD ["run"]
