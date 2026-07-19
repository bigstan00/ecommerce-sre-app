"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ORDER_STATUSES, STATUS_LABEL } from "@/lib/orderStatus";

export default function OrderStatusFilter({ selected }: { selected?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="status-filter" className="label mb-0 whitespace-nowrap">
        Filter by status
      </label>
      <select
        id="status-filter"
        className="input w-auto"
        value={selected ?? ""}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">All statuses</option>
        {ORDER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
    </div>
  );
}
