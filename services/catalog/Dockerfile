# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache module downloads separately from source changes.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build a static binary with no CGO dependency, non-debug symbols stripped.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/catalog-server ./cmd/server

# ---- Final stage ----
FROM alpine:3.20 AS final

# Root CA certs are needed for TLS connections (e.g. MongoDB Atlas SRV/TLS).
RUN apk add --no-cache ca-certificates && \
    addgroup -S catalog && \
    adduser -S -G catalog catalog

WORKDIR /app
COPY --from=builder /out/catalog-server /app/catalog-server

USER catalog

EXPOSE 4002

ENTRYPOINT ["/app/catalog-server"]
