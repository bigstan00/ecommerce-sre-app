# Running everything locally

A step-by-step runbook for standing up the whole app on your own machine to test it —
distinct from `README.md` (reference/overview) and `ARCHITECTURE.md` (design rationale).
This is the "do this, in this order" version.

The `docker run` commands below are a quick way to get infrastructure up for testing today —
they are deliberately NOT a `docker-compose.yml`. Writing that (and later, Kubernetes
manifests) to replace these one-off commands is your own next exercise, not something this
doc does for you.

## 0. Prerequisites

Install these once:

| Tool | Minimum version | Used by |
|---|---|---|
| Node.js | 20+ | Auth, Cart, Gateway, Storefront, Admin |
| Go | 1.26+ | Catalog, Order, Inventory |
| Python | 3.12+ (3.13 recommended) | Payment, Notification |
| Docker | any recent version | Postgres, MongoDB, Redis, Kafka |

## 1. Start infrastructure

Four throwaway containers — one Postgres (shared by four services, via separate
databases/users), one MongoDB, one Redis, one Kafka (KRaft mode, no ZooKeeper needed):

```bash
docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
docker run -d --name mongo -p 27017:27017 mongo:7
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name kafka -p 9092:9092 apache/kafka:3.7.0
```

Give Postgres a few seconds to be ready, then create the extra users/databases four of the
services expect (matches each service's `.env.example` default `DATABASE_URL`):

```bash
docker exec -it pg psql -U postgres -c "CREATE USER auth WITH PASSWORD 'auth' CREATEDB;"
docker exec -it pg psql -U postgres -c "CREATE DATABASE auth OWNER auth;"
docker exec -it pg psql -U postgres -c "CREATE USER inventory WITH PASSWORD 'inventory' CREATEDB;"
docker exec -it pg psql -U postgres -c "CREATE DATABASE inventory OWNER inventory;"
docker exec -it pg psql -U postgres -c "CREATE DATABASE \"order\";"
docker exec -it pg psql -U postgres -c "CREATE DATABASE payment;"
```

(Order and Payment use the default `postgres` user, just a dedicated database each — only
Auth and Inventory need their own dedicated user, per their `.env.example` defaults.)

## 2. Set up each service's `.env`

For **every** service directory (`gateway/`, `frontend/`, `admin/`, and everything under
`services/`): `cp .env.example .env`. The defaults mostly work as-is for this local setup
since they already point at `localhost` on the ports above — but you must edit two values so
they're **identical across the services that share them**:

- `JWT_SECRET` — same value in `services/auth/.env` and `gateway/.env`.
- `ADMIN_TOKEN` — same value in `services/catalog/.env`, `services/inventory/.env`, and
  `services/order/.env`.

Pick any string for each (e.g. `openssl rand -hex 32`) — what matters is that it matches
everywhere it's required, not what the value actually is.

**Important — `.env` is not auto-loaded by every service.** Whether a service reads its
`.env` file on its own depends on the language ecosystem it was built with, and this repo is
not consistent about it:

| Auto-loads `.env` on its own | Needs vars exported into the shell first |
|---|---|
| Auth, Cart, Gateway (Node — `dotenv`) | Catalog, Order, Inventory (Go — no dotenv equivalent wired in) |
| Notification (Python — `python-dotenv`) | Payment (Python — no `python-dotenv`) |

For the four in the right-hand column, run this in every terminal tab **before** any `go run`
or `uvicorn` command in that directory, or it'll fail with a confusing "environment variable
required" error despite the `.env` file existing right next to it:
```bash
set -a; source .env; set +a
```

## 3. Start services, in this order

Order matters here — later services depend on earlier ones being up (and in two cases,
seeded with data). Run each in its own terminal tab so you can see its logs.

**Auth** — needs one manual step before it'll work, unlike the others:
```bash
cd services/auth && npm install
npm run migrate:dev   # creates the users/refresh_tokens tables — do this once
npm run dev
```

**Catalog**, then seed it (Go — needs the `.env` exported first, see above):
```bash
cd services/catalog && set -a && source .env && set +a
go run ./cmd/server &
go run ./cmd/seed     # inserts ~15 sample products — Catalog starts empty otherwise
```

**Cart**:
```bash
cd services/cart && npm install && npm run dev
```

**Order** and **Inventory** (Go — export `.env` in each; both auto-create their own tables
on startup, no manual migration step) — but **Inventory's seed script needs Catalog already
seeded and running**, since it reads the live product list over HTTP:
```bash
cd services/order && set -a && source .env && set +a
go run ./cmd/server &

cd services/inventory && set -a && source .env && set +a
go run ./cmd/server &
go run ./cmd/seed     # gives every Catalog product 100 units of stock
```

**Payment** (Python — also needs `.env` exported, unlike Notification) and **Notification**:
```bash
cd services/payment && set -a && source .env && set +a
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn app.main:app --port 4005

cd services/notification && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn app.main:app --port 4007
```

**Gateway** — start this only once every backend service above is already running, since it
proxies to all of them:
```bash
cd gateway && npm install && npm run dev
```

**Storefront** and **Admin**:
```bash
cd frontend && npm install && npm run dev    # http://localhost:3000

cd admin && npm install && npm run dev       # http://localhost:3001
```

## 4. Confirm it's actually working

In roughly this order:

1. `curl http://localhost:8080/healthz` → `{"status":"ok"}`.
2. `curl http://localhost:8080/readyz` → `{"status":"ready"}`. If not, the response tells you
   which upstream is unreachable — that's your first debugging clue.
3. Open `http://localhost:3000` — you should see the seeded products.
4. Register an account, log in, add a product to your cart, go to `/checkout`, place the
   order.
5. Watch `/orders/[id]` — the status should visibly flip from `pending` →
   `inventory_reserved` → `confirmed` (or `cancelled`, ~10% of the time by design — see
   `PAYMENT_FAILURE_RATE` in `services/payment/.env`) within a couple of seconds, as the
   checkout saga plays out over Kafka in the background.
6. Open `http://localhost:3001`, log in with your `ADMIN_TOKEN`, and confirm the order you
   just placed shows up in `/orders` there too, across the whole system.

If step 5 never resolves past `pending`, Kafka or one of Order/Inventory/Payment isn't
actually connected — check each service's own logs for Kafka connection errors.

## Troubleshooting

- **A service exits immediately on startup** — check its logs for "missing required
  environment variable"; every service fails fast and tells you exactly which one. If it's
  Catalog, Order, Inventory, or Payment and you *know* the value is in your `.env` file, you
  forgot `set -a; source .env; set +a` first — those four don't auto-load `.env` the way the
  others do (see step 2). This is also why a Go service can look like it "half-works" — some
  vars have hardcoded fallback defaults in the code that happen to match `.env.example`
  (so it seems fine), while others (like `ADMIN_TOKEN`) have no fallback and error loudly.
- **401s on cart/orders that should be authenticated** — `JWT_SECRET` mismatch between Auth
  and Gateway is the most common cause.
- **403s on admin routes** — `ADMIN_TOKEN` mismatch between Catalog/Inventory/Order and
  whatever you typed into the admin dashboard's login.
- **`/readyz` on the Gateway stays `503`** — one of Auth/Catalog/Cart/Order isn't up yet, or
  crashed; the response body names which one.
- **Orders stuck on `pending` forever** — Kafka isn't reachable from Order/Inventory/Payment,
  or one of them isn't running. Check `KAFKA_BROKERS=localhost:9092` is set in all four
  Kafka-using services' `.env` files.
- **Catalog/products page is empty** — you started Catalog but forgot `go run ./cmd/seed`.

## Tearing it down

```bash
docker stop pg mongo redis kafka && docker rm pg mongo redis kafka
```
Then `Ctrl+C` every service's terminal tab.
