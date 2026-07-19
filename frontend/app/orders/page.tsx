import Link from "next/link";
import { ApiError, getOrders } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { formatPrice } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  inventory_reserved: "Reserving inventory",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export default async function OrdersPage() {
  const token = getSessionToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in to see your order history."
        action={
          <Link href="/login?next=/orders" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let orders;
  try {
    orders = await getOrders(token);
  } catch (err) {
    return (
      <ErrorBanner
        title="Could not load your orders"
        message={err instanceof ApiError ? err.message : "Please try again shortly."}
      />
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        message="Orders you place will show up here."
        action={
          <Link href="/" className="btn-primary mt-2">
            Shop products
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Your orders</h1>

      <div className="card divide-y divide-slate-200">
        {orders.map((order) => (
          <Link
            key={order.orderId}
            href={`/orders/${order.orderId}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 sm:p-6"
          >
            <div>
              <p className="font-medium text-slate-900">Order {order.orderId}</p>
              <p className="text-sm text-slate-500">
                {STATUS_LABEL[order.status] ?? order.status}
              </p>
            </div>
            <p className="font-semibold text-slate-900">{formatPrice(order.totalAmount)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
