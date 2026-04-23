FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates curl && \
    adduser -D -u 1000 appuser

WORKDIR /app
COPY --from=builder /app/server /app/server

USER appuser

EXPOSE 8004

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8004/health || exit 1

ENTRYPOINT ["/app/server"]
