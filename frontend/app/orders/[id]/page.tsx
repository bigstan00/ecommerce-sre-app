import Link from "next/link";
import { ApiError, getOrder } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import OrderStatusView from "@/components/OrderStatusView";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const token = getSessionToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in to view this order."
        action={
          <Link href={`/login?next=/orders/${params.id}`} className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let order;
  try {
    order = await getOrder(token, params.id);
  } catch (err) {
    return (
      <ErrorBanner
        title="Could not load this order"
        message={err instanceof ApiError ? err.message : "Please try again shortly."}
      />
    );
  }

  if (!order) {
    return (
      <EmptyState
        title="Order not found"
        message="This order doesn't exist, or doesn't belong to you."
        action={
          <Link href="/orders" className="btn-primary mt-2">
            View your orders
          </Link>
        }
      />
    );
  }

  return <OrderStatusView orderId={params.id} initialOrder={order} />;
}
