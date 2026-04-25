# ── Build stage ──────────────────────────────────────────────
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /auth ./cmd/server

# ── Runtime stage ─────────────────────────────────────────────
FROM alpine:3.20

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /auth /auth

RUN adduser -D -u 1000 appuser
USER appuser

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8001/ready >/dev/null || exit 1

ENTRYPOINT ["/auth"]
