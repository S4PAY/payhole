# Build from the repository root: docker build -f packages/verifier/Dockerfile -t payhole-verifier .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @payhole/verifier... \
 && pnpm --filter @payhole/sdk build \
 && pnpm --filter @payhole/verifier build \
 && pnpm --filter @payhole/verifier deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/main.js"]
