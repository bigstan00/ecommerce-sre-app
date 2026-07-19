"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ErrorBanner from "./ErrorBanner";

export default function PlaceOrderButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePlaceOrder() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", { method: "POST" });

      if (res.status === 401) {
        router.push("/login?next=/checkout");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not place order");
      }

      const order = await res.json();
      router.push(`/orders/${order.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place order");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={handlePlaceOrder} disabled={loading} className="btn-primary">
        {loading ? "Placing order..." : "Place order"}
      </button>
      {error && <ErrorBanner title="Could not place order" message={error} />}
    </div>
  );
}
