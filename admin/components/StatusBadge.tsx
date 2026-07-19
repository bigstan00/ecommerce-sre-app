import type { OrderStatus } from "@/lib/types";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/orderStatus";

export default function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        STATUS_STYLE[status] ?? "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
