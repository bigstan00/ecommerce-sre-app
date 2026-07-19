// Status vocabulary shared with the storefront's /orders/[id] page
// (frontend/components/OrderStatusView.tsx) — keep these in sync.
import type { OrderStatus } from "./types";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "inventory_reserved",
  "confirmed",
  "cancelled",
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  inventory_reserved: "Reserving inventory",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  inventory_reserved: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-green-200 bg-green-50 text-green-800",
  cancelled: "border-red-200 bg-red-50 text-red-800",
};
