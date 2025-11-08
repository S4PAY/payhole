# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o payhole-proxy ./cmd/proxy

FROM alpine:3.19 AS runner
RUN addgroup -S payhole && adduser -S payhole -G payhole
WORKDIR /home/payhole
COPY --from=builder /app/payhole-proxy ./payhole-proxy
USER payhole

EXPOSE 8080
EXPOSE 5353/tcp
EXPOSE 5353/udp

ENTRYPOINT ["./payhole-proxy"]
