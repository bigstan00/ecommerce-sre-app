import Link from "next/link";
import { ApiError, getAdminOrders } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import { formatDateTime, formatPrice } from "@/lib/format";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";
import OrderStatusFilter from "@/components/OrderStatusFilter";
import type { OrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface OrdersPageProps {
  searchParams: { status?: string };
}

const VALID_STATUSES = new Set<string>([
  "pending",
  "inventory_reserved",
  "confirmed",
  "cancelled",
]);

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const token = getAdminToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in with the admin token to view orders."
        action={
          <Link href="/login" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  const status =
    searchParams.status && VALID_STATUSES.has(searchParams.status)
      ? (searchParams.status as OrderStatus)
      : undefined;

  let ordersError: string | null = null;
  let orderList: Awaited<ReturnType<typeof getAdminOrders>> = {
    orders: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
  };

  try {
    orderList = await getAdminOrders(token, { limit: PAGE_SIZE, status });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      ordersError = "Admin token was rejected by the Order service. Log in again.";
    } else {
      ordersError =
        err instanceof ApiError ? err.message : "Failed to load orders. Please try again.";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders across all users, from the admin-gated Order service endpoint.
          </p>
        </div>
        <OrderStatusFilter selected={status} />
      </div>

      {ordersError ? (
        <ErrorBanner title="Could not load orders" message={ordersError} />
      ) : orderList.orders.length === 0 ? (
        <EmptyState
          title="No orders found"
          message={status ? `No orders with status "${status}".` : "No orders have been placed yet."}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">User ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orderList.orders.map((order) => (
                <tr key={order.orderId}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{order.orderId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{order.userId}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatPrice(order.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
