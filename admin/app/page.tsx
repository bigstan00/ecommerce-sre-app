import Link from "next/link";
import { ApiError, getAdminOrders, getProducts } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import { ORDER_STATUSES, STATUS_LABEL } from "@/lib/orderStatus";
import type { OrderStatus } from "@/lib/types";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// No aggregation endpoint exists (per shared/CONTRACTS.md), so we fetch a
// large page of admin orders and tally statuses client-side. This is a
// practice-app-scale shortcut: if order volume ever exceeds this limit the
// per-status tallies would undercount, while the "Total orders" tile still
// reflects the backend's authoritative `total`.
const ORDERS_TALLY_LIMIT = 1000;

export default async function DashboardPage() {
  const token = getAdminToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in with the admin token to view the dashboard."
        action={
          <Link href="/login" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let ordersError: string | null = null;
  let productsError: string | null = null;
  let totalOrders = 0;
  let statusCounts: Record<OrderStatus, number> = {
    pending: 0,
    inventory_reserved: 0,
    confirmed: 0,
    cancelled: 0,
  };
  let totalProducts = 0;

  try {
    const orderList = await getAdminOrders(token, { limit: ORDERS_TALLY_LIMIT });
    totalOrders = orderList.total;
    for (const order of orderList.orders) {
      if (order.status in statusCounts) {
        statusCounts[order.status] += 1;
      }
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      ordersError = "Admin token was rejected by the Order service. Log in again.";
    } else {
      ordersError =
        err instanceof ApiError ? err.message : "Failed to load orders. Please try again.";
    }
  }

  try {
    const productList = await getProducts({ limit: 1 });
    totalProducts = productList.total;
  } catch (err) {
    productsError =
      err instanceof ApiError ? err.message : "Failed to load products. Please try again.";
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Operational summary across catalog, inventory, and orders.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Orders
        </h2>
        {ordersError ? (
          <ErrorBanner title="Could not load orders" message={ordersError} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryTile label="Total orders" value={totalOrders} />
            {ORDER_STATUSES.map((status) => (
              <SummaryTile
                key={status}
                label={STATUS_LABEL[status]}
                value={statusCounts[status]}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Catalog
        </h2>
        {productsError ? (
          <ErrorBanner title="Could not load products" message={productsError} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryTile label="Total products" value={totalProducts} />
          </div>
        )}
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/products" className="btn-secondary">
          Manage products
        </Link>
        <Link href="/inventory" className="btn-secondary">
          Manage inventory
        </Link>
        <Link href="/orders" className="btn-secondary">
          View orders
        </Link>
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
