# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache module downloads separately from source changes.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build a static binary with no CGO dependency, non-debug symbols stripped.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/inventory-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/inventory-seed ./cmd/seed

# ---- Final stage ----
FROM alpine:3.20 AS final

# Root CA certs are needed for TLS connections (e.g. managed Postgres, or
# the seed binary calling out to the Catalog service over HTTPS).
RUN apk add --no-cache ca-certificates && \
    addgroup -S inventory && \
    adduser -S -G inventory inventory

WORKDIR /app
COPY --from=builder /out/inventory-server /app/inventory-server
COPY --from=builder /out/inventory-seed /app/inventory-seed

USER inventory

EXPOSE 4006

ENTRYPOINT ["/app/inventory-server"]
