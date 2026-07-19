# Architecture

This document explains *why* the system is built the way it is — the design decisions,
the trade-offs, and how the pieces fit together. For exact endpoint/event specs, see
[`shared/CONTRACTS.md`](shared/CONTRACTS.md). For run instructions, see [`README.md`](README.md).

## 1. Purpose

This is not a product — it's a deliberately over-engineered e-commerce app built as a
deployment practice ground for an SRE brushing up on DevOps fundamentals. The application
code is complete; every operational concern (containerization strategy, orchestration,
networking, secrets management, observability backend) is left for hands-on practice rather
than solved here. The architecture is shaped by that goal: more services than a real system
this size would need, a polyglot stack, and an async saga where a synchronous call would be
simpler — all chosen to maximize the *kinds* of failure modes and operational surface area
available to practice against.

## 2. Architectural style

Three patterns define the system:

- **API gateway + database-per-service microservices.** Nine independently deployable
  services, each owning its own data store exclusively. No service reaches into another
  service's database.
- **Two front doors, one backend.** A customer-facing storefront and a separate admin
  dashboard, each a standalone app with its own auth model, both routed through the same
  gateway.
- **Choreographed saga for checkout.** Placing an order is not one transaction — it's a
  sequence of services reacting to each other's events over Kafka, with each service
  deciding its own next move rather than a central orchestrator dictating the sequence.

## 3. System overview

```
                                   Browser
                    ┌────────────────┴────────────────┐
                    ▼                                  ▼
              Storefront (3000)                Admin dashboard (3001)
              customer JWT, cookie             static admin token, cookie
                    │                                  │
                    └────────────────┬─────────────────┘
                                      ▼
                              API Gateway (8080)
                    reverse proxy · JWT verification for
                    customer routes · passthrough for admin routes
          ┌───────────┬────────────┬────────────┬──────────────┐
          ▼           ▼            ▼            ▼              ▼
        Auth        Catalog       Cart         Order      (admin-only reads
     PostgreSQL     MongoDB      Redis      PostgreSQL      into Catalog/
      :4001          :4002       :4003       :4004         Inventory/Order)
                                     │            │
                                     │            ▼
                                     │      Kafka event bus
                                     │            │
                                     │   ┌────────┼────────┐
                                     │   ▼        ▼        ▼
                                     │ Inventory Payment  Notification
                                     │ PostgreSQL PostgreSQL  (no DB)
                                     │  :4006     :4005      :4007
                                     └── (Cart validates products
                                          against Catalog directly)
```

Catalog, Cart, Order, Inventory, and Payment each have their own database — five separate
data stores, three different technologies (PostgreSQL, MongoDB, Redis), on purpose. This is
the "database per service" pattern: it means no shared-schema coupling between services, but
it also means there is no cross-service transaction — consistency between, say, an order and
its inventory reservation is *eventual*, not atomic. Section 6 covers how that's handled.

## 4. Service catalog

| Service | Owns | Talks to | Auth model |
|---|---|---|---|
| **Storefront** | nothing (stateless UI) | Gateway only | customer JWT (httpOnly cookie) |
| **Admin dashboard** | nothing (stateless UI) | Gateway only | static admin token (httpOnly cookie) |
| **API Gateway** | nothing | all backend services | verifies JWT for customer routes; passes admin token through unverified |
| **Auth** | users, credentials | — | issues/verifies JWTs |
| **Catalog** | product listings | — | admin token for writes |
| **Cart** | per-user cart state | Catalog (sync, product validation) | trusts gateway's `X-User-Id` |
| **Order** | order records, saga state | Cart (sync), Kafka (async) | trusts gateway's `X-User-Id`; admin token for the cross-user admin read |
| **Inventory** | stock levels, reservations | Kafka only | admin token for writes/reads |
| **Payment** | payment records | Kafka only | none (no external callers) |
| **Notification** | nothing (stateless consumer) | Kafka only | none |

Two services are intentionally never reachable synchronously by anything except their own
optional debug endpoints: **Payment** and **Notification**. They exist entirely to react to
events. That's a deliberate choice to give you services whose *only* interface is a message
queue — a different operational shape than an HTTP service, worth practicing against
separately (e.g., "how do I know Payment is healthy if nothing calls it?" — the answer is its
own `/healthz`/`/readyz`, checked out-of-band, not via request traffic).

## 5. Trust boundaries

There are two distinct credential systems in this app, and they don't mix:

**Customer identity (JWT).** Auth issues an HS256 JWT. The gateway is the *only* place that
verifies it. Once verified, the gateway injects `X-User-Id` and everything downstream
(Cart, Order) trusts that header unconditionally — they do not re-verify the JWT themselves.
This is realistic microservice design: the gateway is the trust boundary, not each service.
It also means these services are **only as safe as the network path to them** — if something
other than the gateway can reach Cart or Order directly, it can impersonate any user by
setting `X-User-Id` itself. Enforcing that nothing else can reach them (Kubernetes
NetworkPolicies, or equivalent isolation in Compose) is explicitly left as a deployment
exercise, not solved in code.

**Admin identity (static token).** Catalog, Inventory, and Order's admin endpoints use a
shared `ADMIN_TOKEN` value, checked independently by each service — the gateway does not
verify it, it just forwards the header untouched. This is a *weaker* mechanism than JWT (no
expiry, no per-user identity, one shared secret) used deliberately for the lower-stakes admin
surface. It also means the admin dashboard's traffic and the storefront's traffic currently
share the same network path through the gateway to Catalog/Inventory/Order — a real
deployment would likely want to isolate admin traffic further than this code does. Worth
deciding deliberately when you get to NetworkPolicies.

**Neither system is enforced by the gateway for admin routes** — that's intentional
asymmetry, not an oversight: JWT-gated routes are business-critical customer paths where
centralizing verification at the gateway reduces duplicated logic; admin-token routes are
low-volume operational paths where each service owning its own check is simpler than
threading a second verification scheme through the gateway.

## 6. The checkout saga

Placing an order can't be a single database transaction — the order, the stock reservation,
and the payment each live in different services with different databases. Instead, `POST
/orders` does the minimum synchronous work (validate the cart isn't empty, write the order
as `pending`, clear the cart) and publishes `order.created`. Everything after that is three
services independently reacting to Kafka events, each moving the order one step closer to a
terminal state:

```
Order: pending ──(order.created)──▶ Inventory reserves stock
                                          │
                         succeeds ────────┼──── fails
                            ▼                      ▼
                  inventory.reserved      inventory.failed
                            │                      │
                            ▼                      ▼
                  Order: inventory_reserved   Order: cancelled ──▶ order.cancelled
                            │
                            ▼
                  Payment simulates a charge
                            │
                 succeeds ──┼── fails
                    ▼               ▼
          payment.completed   payment.failed
                    │               │
                    ▼               ▼
          Order: confirmed    Order: cancelled
                    │          + Inventory releases
                    ▼            the reservation
            order.confirmed          │
                    │                ▼
                    ▼          order.cancelled
             Notification
             logs mock email    Notification logs
                                mock email
```

Three properties make this safe under Kafka's at-least-once delivery:

- **Idempotent consumers.** Every handler checks current state before acting — e.g. Order's
  `payment.completed` handler only transitions `inventory_reserved → confirmed`; a duplicate
  delivery for an already-`confirmed` order is a logged no-op, not a re-publish.
- **Ownership of failure recovery.** Inventory, not Order, is responsible for releasing a
  stock reservation when payment fails — the service that made the reservation is the one
  that undoes it. This is compensation, not a rollback in the database-transaction sense —
  there's no event published for it, because it isn't a new business fact, just cleanup.
- **A visible eventual-consistency window.** `POST /orders` returns `pending` immediately,
  before the saga has even started. The storefront's `/orders/[id]` page polls every 2
  seconds specifically to make that lag visible — watching the status flip from `pending` →
  `inventory_reserved` → `confirmed` in near-real-time is the most direct way to *see*
  eventual consistency happen, rather than just knowing about it abstractly.

`PAYMENT_FAILURE_RATE` (default 10%) and simulated latency exist to make the failure path
reachable on demand — you don't have to wait for a real failure to see `cancelled` orders and
compensating inventory releases happen.

## 7. Known trade-offs

Two gaps were discovered and deliberately accepted (not fixed) while building this, and are
worth knowing about before you build monitoring or chaos experiments around them:

- **Payment infers order amount from a side-channel, not the saga's main event.**
  `inventory.reserved` — the event that actually triggers Payment — carries only product IDs
  and quantities, no price. Rather than change the contract, Payment separately subscribes to
  `order.created` (which does carry `totalAmount`) purely to cache the amount per order ID
  before it's needed. In the rare case the cache hasn't landed yet, it retries briefly (~2.5s)
  then falls back to `0.0` and logs a warning rather than blocking the saga. This is an
  internal implementation detail of Payment only — no other service knows about it.

- **Inventory has a narrow crash-recovery gap.** If the process dies mid-way through
  reserving a multi-item order (after reserving item 1 of 2, before publishing the result),
  restart will see the partial reservation rows already present and treat the event as fully
  handled rather than resuming it. This is the accepted cost of not implementing the outbox
  pattern — normal duplicate-delivery idempotency is solid, this only affects that one narrow
  crash window mid-handler.

Both are the kind of thing a real production readiness review would flag — they're left in
place deliberately as realistic imperfections to notice, not smoothed over.

## 8. What's built

All five phases are built: customer storefront, full backend, checkout saga, gateway rate
limiting, distributed tracing, and the admin dashboard.

**Phase 3, rate limiting**: three `@fastify/rate-limit` instances layered on top of each
other, not replacing one another — general (every route, keyed by IP), auth-specific
(stricter, `/api/auth/*` only, also IP-keyed since there's no identity yet on those routes),
and per-user (`/api/cart/*` and `/api/orders/*` only, keyed by user ID instead of IP so
people sharing an office/NAT'd IP don't share one budget). The per-user one runs at a later
request-lifecycle stage than the other two specifically so it executes after the JWT check
has already populated the user's identity — and its limit is enforced at startup to always
stay below the general limit, since otherwise a single user could exhaust the shared IP
budget before their own cap ever engaged. The counter store itself is a config toggle
(in-memory by default, Redis via `RATE_LIMIT_REDIS_URL`) specifically because naive
in-memory counting silently breaks once you run more than one gateway replica — see
`gateway/README.md`'s "Rate limiting" section for the full picture.

**Phase 4, distributed tracing**: every backend service (not Storefront/Admin — that's a
deliberate scope boundary, this phase traces the backend saga, not browser rendering) is
instrumented with OpenTelemetry. HTTP hops use each language's standard auto-instrumentation
(no manual span code needed there). The Kafka hops — the part that doesn't show up in
typical HTTP-only tracing tutorials — carry trace context as a `traceparent` message header,
injected on publish and extracted on consume, using each language's standard W3C Trace
Context propagator rather than a hand-rolled scheme, which is exactly what lets a trace
started in Go's Order service continue correctly into Python's Payment service. This was
verified during development the same way the checkout saga's idempotency was verified in
Phase 2 — not by reading the code, but by actually injecting a known trace ID into a
hand-crafted Kafka message, consuming it through the real service code, and checking the
resulting span's trace ID matched exactly, then checking the *next* message that service
published still carried that same ID. Every pairwise hop in the saga was confirmed this way.

Deployment — containers, orchestration, networking, secrets, the observability backend
itself — is entirely out of scope for this document and this codebase by design. See
[`README.md`](README.md) for what each service needs at runtime.
