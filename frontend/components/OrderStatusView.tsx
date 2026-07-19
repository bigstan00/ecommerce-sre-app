"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Order, OrderStatus } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import ErrorBanner from "./ErrorBanner";

const POLL_INTERVAL_MS = 2000;
const ACTIVE_STATUSES = new Set<OrderStatus>(["pending", "inventory_reserved"]);

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  inventory_reserved: "Reserving inventory",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  inventory_reserved: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-green-200 bg-green-50 text-green-800",
  cancelled: "border-red-200 bg-red-50 text-red-800",
};

export default function OrderStatusView({
  orderId,
  initialOrder,
}: {
  orderId: string;
  initialOrder: Order;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [pollError, setPollError] = useState<string | null>(null);
  const isActive = ACTIVE_STATUSES.has(order.status);

  // Polls the order status while the saga is still in flight. Stops as soon
  // as the order reaches a terminal state (confirmed/cancelled) so we don't
  // keep hitting the gateway forever.
  useEffect(() => {
    if (!ACTIVE_STATUSES.has(order.status)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Could not refresh order status");
        }
        const data = (await res.json()) as Order;
        setOrder(data);
        setPollError(null);
      } catch (err) {
        setPollError(err instanceof Error ? err.message : "Could not refresh order status");
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [orderId, order.status]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Order</h1>
        <Link href="/orders" className="text-sm font-medium text-brand-600 hover:underline">
          All orders
        </Link>
      </div>

      <div className={`card flex flex-col gap-2 border p-6 ${STATUS_STYLE[order.status]}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-75">Status</p>
        <p className="text-2xl font-bold">{STATUS_LABEL[order.status] ?? order.status}</p>
        {order.status === "cancelled" && order.cancelReason && (
          <p className="text-sm">{order.cancelReason}</p>
        )}
        {isActive && (
          <p className="text-sm opacity-75">
            Refreshing every 2 seconds while payment and inventory reservation complete...
          </p>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold text-slate-900">Items</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {order.items.map((item) => (
            <li key={item.productId} className="flex items-center justify-between text-slate-600">
              <span>
                {item.quantity} &times; product {item.productId}
              </span>
              <span>{formatPrice(item.priceSnapshot * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3 text-lg font-bold text-slate-900">
          <span>Total</span>
          <span>{formatPrice(order.totalAmount)}</span>
        </div>
      </div>

      {pollError && <ErrorBanner title="Live status update failed" message={pollError} />}

      <p className="text-center text-xs text-slate-400">Order ID: {orderId}</p>
    </div>
  );
}
