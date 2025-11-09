# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ libusb-dev linux-headers eudev-dev
ENV npm_config_python=python3

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
ARG NEXT_PUBLIC_PROXY_HTTP_URL
ARG NEXT_PUBLIC_PROXY_HEALTH_URL
ARG NEXT_PUBLIC_PROXY_DNS_ADDR
ARG PAYMENTS_API_BASE_URL
ARG ANALYTICS_API_BASE_URL
ARG NEXT_PUBLIC_TREASURY_WALLET
ARG NEXT_PUBLIC_PAYMENT_AMOUNT_USDC
ARG NEXT_PUBLIC_USDC_MINT_ADDRESS
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_PROXY_HTTP_URL=${NEXT_PUBLIC_PROXY_HTTP_URL} \
    NEXT_PUBLIC_PROXY_HEALTH_URL=${NEXT_PUBLIC_PROXY_HEALTH_URL} \
    NEXT_PUBLIC_PROXY_DNS_ADDR=${NEXT_PUBLIC_PROXY_DNS_ADDR} \
    PAYMENTS_API_BASE_URL=${PAYMENTS_API_BASE_URL} \
    ANALYTICS_API_BASE_URL=${ANALYTICS_API_BASE_URL} \
    NEXT_PUBLIC_TREASURY_WALLET=${NEXT_PUBLIC_TREASURY_WALLET} \
    NEXT_PUBLIC_PAYMENT_AMOUNT_USDC=${NEXT_PUBLIC_PAYMENT_AMOUNT_USDC} \
    NEXT_PUBLIC_USDC_MINT_ADDRESS=${NEXT_PUBLIC_USDC_MINT_ADDRESS} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/tailwind.config.ts ./tailwind.config.ts

EXPOSE 3000

CMD ["npm", "run", "start"]
