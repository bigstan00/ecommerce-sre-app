# Storefront (frontend)

Next.js 14 (App Router, TypeScript, Tailwind CSS) storefront for the practice
e-commerce distributed system. This service talks **only** to the API
gateway — it never calls Auth, Catalog, or Cart directly.

## Running locally

```bash
npm install
cp .env.example .env.local   # adjust NEXT_PUBLIC_API_URL if needed
npm run dev
```

The app starts on `http://localhost:3000`.

> This app expects the **gateway** (and the services behind it) to be running
> and reachable at `NEXT_PUBLIC_API_URL` (default `http://localhost:8080/api`).
> If the gateway isn't up, pages will render with a visible error/empty state
> instead of data — that's expected, not a bug.

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

## Pages

| Route | Description |
|---|---|
| `/` | Product listing — grid, category filter, pagination (`GET /api/products`, `GET /api/categories`). |
| `/products/[id]` | Product detail with an "Add to cart" button (`GET /api/products/:id`, `POST /api/cart/items`). |
| `/cart` | View cart items, adjust quantity, remove items, see total (`GET/PUT/DELETE /api/cart/...`). |
| `/checkout` | Stub only — shows cart summary and a disabled "Place order (coming in Phase 2)" button. No real checkout logic yet. |
| `/login` | Login form. |
| `/register` | Registration form. |
| `/healthz` | Liveness endpoint (`200 {"status":"ok"}`), per the cross-cutting service conventions. |

## Auth token handling

On successful login/register, the frontend calls a Next.js Route Handler
(`/app/api/session/route.ts`) which itself calls the gateway's
`/api/auth/login` or `/api/auth/register`, then stores the resulting access
token in an **httpOnly** cookie (`sf_session`) on the response. The token is
never exposed to client-side JavaScript and is never stored in
`localStorage`.

Server Components and Route Handlers read that cookie (`lib/session.ts`) to
attach `Authorization: Bearer <token>` when calling cart endpoints on the
gateway. Because the cookie is httpOnly, Client Components that need to
mutate the cart (quantity changes, add/remove) call same-origin proxy Route
Handlers under `/app/api/cart/*`, which read the cookie server-side and
forward the request to the gateway — the browser never handles the token
directly.

## Architecture notes

- `lib/api.ts` — the single typed client wrapping every gateway call
  (`/api/auth/*`, `/api/products/*`, `/api/categories/*`, `/api/cart/*`),
  matching `shared/CONTRACTS.md` exactly.
- `lib/session.ts` — server-only helpers for reading the session cookie.
- `app/api/session/route.ts` — login/register broker, sets/clears the
  httpOnly cookie.
- `app/api/cart/**` — same-origin proxy routes so Client Components can
  mutate the cart without ever touching the raw token.

## Docker

```bash
docker build -t storefront --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080/api .
docker run --rm -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://localhost:8080/api storefront
```

Multi-stage build (`deps` → `builder` → `runner`), runs as a non-root user
(`nextjs`), and ships only the Next.js `standalone` output — no dev
dependencies or full `node_modules` in the final image.
