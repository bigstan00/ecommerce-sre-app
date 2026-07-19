# Admin (dashboard)

Next.js 14 (App Router, TypeScript, Tailwind CSS) admin dashboard for the
practice e-commerce distributed system. A separate, standalone deployable
from the customer-facing `frontend/` storefront — separate auth model
(static admin token, not a customer JWT), separate directory, separate port.
This service talks **only** to the API gateway — it never calls Catalog,
Inventory, or Order directly.

## Running locally

```bash
npm install
cp .env.example .env.local   # adjust NEXT_PUBLIC_API_URL if needed
npm run dev
```

The app starts on `http://localhost:3001`.

> This app expects the **gateway** (and the Catalog/Inventory/Order services
> behind it) to be running and reachable at `NEXT_PUBLIC_API_URL` (default
> `http://localhost:8080/api`). If the gateway isn't up, pages render a
> visible error/empty state instead of data or a crash — that's expected,
> not a bug.

### Build for production

```bash
npm run build
npm start
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080/api` | Base URL of the API gateway. Inlined into the client bundle at build time (must be set before `npm run build` in Docker). |

See `.env.example`.

**Important — shared `ADMIN_TOKEN`**: this dashboard sends a single
`X-Admin-Token` header value to every admin endpoint. As of Phase 5,
`ADMIN_TOKEN` must be set to the **same value** in `services/catalog/.env`,
`services/inventory/.env`, and `services/order/.env` — the token you type
into `/login` here must match all three, or requests to whichever service
has a different value will be rejected with `403`.

## Pages

| Route | Description |
|---|---|
| `/login` | Single admin-token field. Verifies the token against `GET /api/admin/inventory?limit=1` (rejects only on an explicit `403`), then stores it in an httpOnly cookie. |
| `/` | Dashboard home — summary tiles for total orders and a count per status (`pending`, `inventory_reserved`, `confirmed`, `cancelled`), tallied client-side from `GET /api/admin/orders` (no aggregation endpoint exists), plus a total product count from the public `GET /api/products`. |
| `/products` | Lists products from the public `GET /api/products`, plus a "create product" form that `POST`s to `/api/admin/products` via a same-origin proxy route. |
| `/inventory` | Lists stock from `GET /api/admin/inventory`, plus a "set stock" form that `POST`s to `/api/admin/inventory` via a same-origin proxy route. |
| `/orders` | Lists orders across **all** users from `GET /api/admin/orders` (`orderId`, `userId`, color-coded `status`, `totalAmount`, `createdAt`), with an optional status filter dropdown. |
| `/healthz` | Liveness endpoint (`200 {"status":"ok"}`), per the cross-cutting service conventions. |

No edit/delete flows — create and list only, per spec.

## Auth token handling

On submit, `/login` posts to a Next.js Route Handler
(`/app/api/session/route.ts`), which calls the gateway's
`GET /api/admin/inventory?limit=1` with the submitted value as
`X-Admin-Token`. A `403` means the token is wrong and login is rejected;
any other outcome (success, or the backend being briefly unreachable) is
treated as "not proven invalid" so a transient outage doesn't block login —
other pages still show their own error states if the backend stays down.
On acceptance, the token is stored in an **httpOnly** cookie (`admin_token`)
on the response. It is never exposed to client-side JavaScript and never
stored in `localStorage`.

Server Components and Route Handlers read that cookie (`lib/session.ts`) to
attach `X-Admin-Token: <token>` when calling admin endpoints on the gateway.
Because the cookie is httpOnly, Client Components that need to mutate data
(create product, set stock) call same-origin proxy Route Handlers under
`/app/api/products` and `/app/api/inventory`, which read the cookie
server-side and forward the request to the gateway — the browser never
handles the token directly.

## Architecture notes

- `lib/api.ts` — the single typed client wrapping every gateway call this
  app makes (`/api/products` public reads, `/api/admin/products`,
  `/api/admin/inventory`, `/api/admin/orders`), matching
  `shared/CONTRACTS.md`'s Phase 5 section exactly. Same `ApiError` shape and
  fetch-wrapper pattern as `frontend/lib/api.ts`.
- `lib/session.ts` — server-only helpers for reading the session cookie.
- `lib/orderStatus.ts` — shared status label/color vocabulary, matching the
  storefront's `/orders/[id]` page.
- `app/api/session/route.ts` — token verification + httpOnly cookie
  set/clear.
- `app/api/products/route.ts`, `app/api/inventory/route.ts` — same-origin
  proxy routes so Client Components can submit forms without ever touching
  the raw token.

## Docker

```bash
docker build -t admin --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080/api .
docker run --rm -p 3001:3001 -e NEXT_PUBLIC_API_URL=http://localhost:8080/api admin
```

Multi-stage build (`deps` → `builder` → `runner`), runs as a non-root user
(`nextjs`), and ships only the Next.js `standalone` output — no dev
dependencies or full `node_modules` in the final image.
