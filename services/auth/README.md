# Auth Service

Handles user registration, login, token refresh, and session/profile lookup
for the ecommerce-sre-app practice distributed system. Node.js + TypeScript,
Fastify, PostgreSQL (via `pg`, raw SQL, no ORM), bcrypt, JWT (HS256), pino
structured logging.

Port: **4001** (see `PORT` env var). Other services reach it via
`AUTH_SERVICE_URL`.

## Trust boundary

The API gateway is the only public entry point in this system. Downstream
services (this one included) trust the `X-User-Id` header set by the
gateway and do **not** re-verify JWTs themselves for gateway-forwarded
requests. This service's own `/auth/me` and `/auth/logout` endpoints *do*
verify the bearer JWT directly, since they are the source of truth for
token validity — but nothing here re-checks a `X-User-Id` header from
upstream. This is realistic microservice practice, not an oversight: it
only stays safe if network policy prevents anything but the gateway from
reaching this service directly.

**TODO (Phase 2/3):** add a Kubernetes NetworkPolicy so only the gateway
can reach this service's port — do not "fix" this by adding gateway-style
JWT verification to every route here.

## Running locally

Prerequisites: Node.js 18+, and a reachable PostgreSQL instance.

1. Copy the env file and adjust `DATABASE_URL` (and `JWT_SECRET` if you
   want it to match a locally-running gateway):

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the migrations against the database in `DATABASE_URL`. This creates
   the `users` table (per CONTRACTS.md) plus a supporting `refresh_tokens`
   table (see note below):

   ```bash
   npm run migrate:dev      # ts-node, no build needed
   # or, after `npm run build`:
   npm run migrate
   ```

4. Start the service:

   ```bash
   npm run dev      # ts-node-dev, auto-reload
   # or
   npm run build && npm start
   ```

The service will refuse to start if a required env var (`DATABASE_URL`,
`JWT_SECRET`) is missing — check stdout for a structured JSON error log.

### Note on the `refresh_tokens` table

CONTRACTS.md only specifies a `users` table. To make `/auth/refresh`
actually validatable and `/auth/logout` actually revoke something (rather
than being a no-op), this service also maintains a `refresh_tokens` table
(hashed tokens, expiry, revocation timestamp) via
`migrations/002_create_refresh_tokens.sql`. Logout revokes all of a user's
outstanding refresh tokens; it does not blacklist the still-live access
token (access tokens are short-lived — 15m by default — and expire
naturally).

## Environment variables

All config is via environment variables — see `.env.example` for the full
list with dummy defaults:

| Var | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `4001` | HTTP port the server listens on |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **yes** | — | HS256 signing secret; must match the gateway's `JWT_SECRET` |
| `ACCESS_TOKEN_TTL` | no | `15m` | Access token lifetime (`<n>s\|m\|h\|d` or bare seconds) |
| `REFRESH_TOKEN_TTL` | no | `7d` | Refresh token lifetime, same format |
| `LOG_LEVEL` | no | `info` | pino log level |

## Endpoints

Business endpoints (all under `/auth`):

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | none | `{email, password, name}` | `201 {userId}` / `409` if email taken |
| POST | `/auth/login` | none | `{email, password}` | `200 {accessToken, refreshToken, expiresIn}` / `401` on bad creds |
| POST | `/auth/refresh` | none | `{refreshToken}` | `200 {accessToken}` / `401` if invalid/expired/revoked |
| GET | `/auth/me` | `Authorization: Bearer <accessToken>` | — | `200 {userId, email, name}` / `401` |
| POST | `/auth/logout` | `Authorization: Bearer <accessToken>` | — | `204` (revokes all refresh tokens for the user) |

Passwords are hashed with bcrypt (cost 12). Access tokens are JWTs signed
HS256 with `sub` = user id and `email` claim, TTL 15m by default. Refresh
tokens are opaque random tokens, stored server-side hashed (SHA-256), TTL
7d by default.

Operational endpoints (cross-cutting convention, same on every service in
this repo):

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness — `200 {"status":"ok"}`, no dependency checks |
| GET | `/readyz` | Readiness — pings Postgres; `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}` |
| GET | `/metrics` | Prometheus exposition format: `http_requests_total`, `http_request_duration_seconds` (histogram), `http_errors_total` |

## Logs

Structured JSON, one object per line, to stdout (pino). Every line has
`timestamp`, `level`, `service` ("auth"), `message`, plus request-scoped
context (`reqId`, `req`/`res` summaries on request logs, `userId` on
auth-flow logs, etc). No `console.log` is used for application logging.

## Tracing

Phase 4 adds OpenTelemetry distributed tracing so a request can be followed
across services. `src/tracing.ts` is imported as the very first line of
`src/index.ts` (before `./app`, `./config`, `pg`, etc.) and initializes
`@opentelemetry/sdk-node` with `@opentelemetry/auto-instrumentations-node`,
exporting via OTLP over HTTP (`@opentelemetry/exporter-trace-otlp-http`).
That ordering matters: auto-instrumentation patches modules at `require()`
time, so it has to run before anything else requires them.

- **Instrumented automatically, no manual span code**: the HTTP server
  (every `/auth/*`, `/healthz`, `/readyz`, `/metrics` request) and the
  Postgres client (`pg`) used by `src/db/pool.ts`.
- **Propagation**: W3C Trace Context (the OTel SDK's default propagator) —
  when the gateway forwards a request here with a `traceparent` header,
  this service's spans automatically continue that same trace.
- **Config**: `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`)
  and `OTEL_SERVICE_NAME` (default `auth-service`) — both standard OTel env
  vars read automatically by the SDK, see `.env.example`. If the endpoint is
  unreachable, spans are dropped and a warning is logged; tracing never
  blocks startup or requests.
- **Sampling: always-on (100%)**. This is a deliberate simplification for
  this practice app's low traffic — a production deployment would sample
  well below 100% to control span volume/cost.

## Docker

Multi-stage build (`Dockerfile`): installs and compiles in intermediate
stages, ships only production `node_modules` + compiled `dist/` +
`migrations/` in the final `node:20-alpine` image, runs as a non-root
`app` user, and includes a container `HEALTHCHECK` against `/healthz`.

```bash
docker build -t auth-service .
docker run --rm -p 4001:4001 --env-file .env auth-service
```

Migrations are not run automatically on container start — run
`npm run migrate` (or `node dist/db/migrate.js`) against `DATABASE_URL`
before/alongside first startup.
