# E-commerce SRE Practice App — Phase 1 + 2 + 3 + 4 + 5

A distributed e-commerce app built purely as a deployment practice ground. The app code is
done — customer storefront, full backend, checkout saga, gateway rate limiting, distributed
tracing, admin dashboard; deploying it (Docker Compose first, then Kubernetes) is
deliberately left to you.

See [`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md) for a step-by-step runbook to get the
whole app running on your own machine. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
design rationale, trust boundaries, and the checkout saga explained. See
[`shared/CONTRACTS.md`](shared/CONTRACTS.md) for the full API contract and Kafka event
schema every service was built against.

## What's here

| Service | Path | Stack | Port |
|---|---|---|---|
| Storefront | `frontend/` | Next.js 14 (App Router) + TypeScript + Tailwind | 3000 |
| Admin dashboard | `admin/` | Next.js 14 (App Router) + TypeScript + Tailwind | 3001 |
| API Gateway | `gateway/` | Node.js + TypeScript + Fastify | 8080 |
| Auth | `services/auth/` | Node.js + TypeScript + Fastify + PostgreSQL | 4001 |
| Catalog | `services/catalog/` | Go + chi + MongoDB | 4002 |
| Cart | `services/cart/` | Node.js + TypeScript + Fastify + Redis | 4003 |
| Order | `services/order/` | Go + chi + PostgreSQL + Kafka | 4004 |
| Payment | `services/payment/` | Python + FastAPI + PostgreSQL + Kafka | 4005 |
| Inventory | `services/inventory/` | Go + chi + PostgreSQL + Kafka | 4006 |
| Notification | `services/notification/` | Python + Kafka (no DB) | 4007 |

Gateway rate limiting (Phase 3) is done — three limiters (general, a stricter one on
`/api/auth/*`, and a per-user one on `/api/cart/*`/`/api/orders/*`), Redis-ready for
multi-replica deployments. See [`gateway/README.md`](gateway/README.md#rate-limiting) for
details.

Distributed tracing (Phase 4) is done — OpenTelemetry instrumentation across all 8 backend
services (not the Storefront/Admin frontends, which is a deliberate scope boundary — this
phase is about tracing the backend saga, not browser-side rendering). Every synchronous HTTP
hop and every Kafka hop in the checkout saga carries trace context, so a single
`POST /orders` can be followed as one continuous trace all the way through
Gateway → Order → Kafka → Inventory → Kafka → Payment → Kafka → Order → Kafka →
Notification. See each service's README "Tracing" section, and
[`shared/CONTRACTS.md`](shared/CONTRACTS.md)'s "Phase 4" section for the exact header/span
conventions every service follows identically.

## Before you run anything: shared secrets

Each service ships its own `.env.example` with a *dummy* placeholder value for anything
that must be shared across services. You must set these to the **same real value** in
every service's actual `.env` — they will not work with mismatched defaults:

- `JWT_SECRET` — must be identical in `services/auth/.env` and `gateway/.env`. Auth signs
  tokens with it, the gateway verifies them with it.
- `ADMIN_TOKEN` — **as of Phase 5, must be identical** in `services/catalog/.env`,
  `services/inventory/.env`, and `services/order/.env`. (Earlier phases let Catalog and
  Inventory use different values since nothing needed both at once — the admin dashboard
  now sends one token and expects it to work against all three.) Needed for `POST /products`
  (Catalog), `POST /inventory` + `GET /inventory` (Inventory), and `GET /admin/orders` (Order).
- `KAFKA_BROKERS` — must point at the same broker(s) in every Phase 2 service's `.env`
  (`order`, `inventory`, `payment`, `notification`).

## Data stores each service needs at runtime

- Auth → PostgreSQL (run `services/auth`'s migrations after the DB is up — see its README)
- Catalog → MongoDB (run `go run ./cmd/seed` from `services/catalog` after Mongo is up to get sample products)
- Cart → Redis
- Order → PostgreSQL (migrations auto-apply on boot) + Kafka
- Inventory → PostgreSQL (migrations auto-apply on boot) + Kafka. **Run order matters**:
  Catalog must be seeded and running first, then run `go run ./cmd/seed` from
  `services/inventory` to seed matching stock rows — it reads the live product list from
  Catalog over HTTP.
- Payment → PostgreSQL + Kafka
- Notification → Kafka only, no database

None of these are provided here — standing them up (as containers, in Compose, or in k8s
as StatefulSets/Deployments) is part of the exercise. Kafka topics are created by their
owning producer service on startup, so bring Kafka up before the Phase 2 services.

## Request flow

**Synchronous (Phase 1, browsing/cart):**
```
Browser → Storefront (3000)
Storefront → Gateway (8080) [server-side only, token in httpOnly cookie]
Gateway → Auth (4001)       /api/auth/*        no JWT check
Gateway → Catalog (4002)    /api/products/*, /api/categories/*   no JWT check
Gateway → Cart (4003)       /api/cart/*        JWT required, injects X-User-Id
Cart → Catalog (4002)       GET /products/:id  (price/existence validation)
```

**Checkout (Phase 2 — synchronous kickoff, then async saga):**
```
Gateway → Order (4004)   POST /api/orders   JWT required, injects X-User-Id
Order → Cart (4003)      reads + clears the cart synchronously
Order → Kafka            publishes order.created, returns 201 immediately (status: pending)

                          ┌─── the saga runs asynchronously from here ───┐
Inventory consumes order.created → reserves stock → publishes inventory.reserved | inventory.failed
Payment    consumes inventory.reserved → simulates charge → publishes payment.completed | payment.failed
Order      consumes all four saga events → drives its own status: pending → inventory_reserved → confirmed | cancelled
Inventory  consumes payment.failed → releases the reservation (compensating action)
Notification consumes order.confirmed | order.cancelled → logs a mock "email sent"
```

Watch this happen live at `/orders/[id]` in the storefront — it polls every 2 seconds and
the status visibly flips as Kafka events land. That visible eventual-consistency lag is the
whole point of Phase 2.

**Admin (Phase 5 — separate app, separate credential):**
```
Admin browser → Admin dashboard (3001) → Gateway (8080), token in httpOnly cookie
Gateway → Catalog (4002)    /api/admin/products/*    passthrough, no JWT — X-Admin-Token forwarded as-is
Gateway → Inventory (4006)  /api/admin/inventory/*   passthrough, no JWT — X-Admin-Token forwarded as-is
Gateway → Order (4004)      /api/admin/orders/*      passthrough, no JWT — X-Admin-Token forwarded as-is
```
Unlike every other authenticated route, the gateway does not verify `X-Admin-Token` itself —
it forwards the header untouched and each downstream service checks it against its own
`ADMIN_TOKEN`. The admin dashboard is a fully separate Next.js app from the storefront
(different port, different login, different cookie) — a deliberate split matching how a real
internal admin tool would be deployed and access-controlled separately from the public site.

## Tracing (Phase 4)

Every backend service reads two standard OTel env vars — `OTEL_EXPORTER_OTLP_ENDPOINT`
(default `http://localhost:4318`) and `OTEL_SERVICE_NAME` (a sensible per-service default is
already set, e.g. `order-service`) — and exports spans via OTLP/HTTP. None of these block
startup or requests if the endpoint is unreachable; a failed export just logs a warning.
Standing up the actual backend that receives these spans (Jaeger, Tempo, whatever you pick)
is on you, same as every other piece of infrastructure in this repo — point every service's
`OTEL_EXPORTER_OTLP_ENDPOINT` at it once it's running.

The Kafka side of this is the interesting part: trace context rides in a `traceparent`
message header (W3C format) on every event in the saga — Order, Inventory, and Payment all
inject it on publish and extract it on consume, and Notification extracts it on its two
consumed topics. This was verified during development by checking actual trace ID equality
across real produce→consume boundaries (not just that spans exist) — see each service's
README "Tracing" section for what was specifically checked.

## Trust boundary — read before you write NetworkPolicies

Auth, Catalog, Cart, and Order all trust the gateway rather than re-verifying JWTs
themselves (Cart and Order in particular trust an `X-User-Id` header with no further
check). That's realistic microservice design, but it only stays safe if network policy
prevents anything but the gateway from reaching these services directly. Locking that down
with Kubernetes NetworkPolicies (and equivalent isolation in your Compose setup) is
intentionally left as part of your practice, not solved in the code.

Payment is never called synchronously by anything except its own optional debug endpoint
(`GET /payments/{orderId}`) — it only communicates over Kafka. Notification has no synchronous
callers at all. Both are good candidates for the strictest NetworkPolicies of all: nothing but
Kafka client traffic and their own health checks should reach them.

Catalog's, Inventory's, and Order's admin routes are a different trust model from everything
else: they don't trust the gateway's identity injection (there's no `X-User-Id` involved) —
each service independently validates `X-Admin-Token` against its own `ADMIN_TOKEN`. The
gateway is a dumb passthrough here, not a trust boundary. Worth deciding deliberately when you
get to NetworkPolicies whether the admin dashboard should reach these services on the same
network path as the public storefront traffic, or a separate one — a real deployment would
likely isolate admin traffic further than this code does.

## Per-service docs

Each service directory has its own `README.md` with exact run instructions, env vars, and
endpoint list. Each has a `Dockerfile`; none have `docker-compose.yml` or k8s manifests —
that's yours to write.
