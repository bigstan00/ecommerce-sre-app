"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AddToCartButton({
  productId,
  maxQuantity,
}: {
  productId: string;
  maxQuantity: number;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const disabled = maxQuantity <= 0;

  async function handleAdd() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });

      if (res.status === 401) {
        router.push(`/login?next=/products/${productId}`);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not add item to cart");
      }

      setStatus("done");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not add item to cart");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label htmlFor="quantity" className="label mb-0">
          Quantity
        </label>
        <select
          id="quantity"
          className="input w-20"
          value={quantity}
          disabled={disabled}
          onChange={(e) => setQuantity(Number(e.target.value))}
        >
          {Array.from({ length: Math.min(maxQuantity, 10) || 1 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <button onClick={handleAdd} disabled={disabled || status === "loading"} className="btn-primary">
        {disabled ? "Out of stock" : status === "loading" ? "Adding..." : "Add to cart"}
      </button>

      {status === "done" && (
        <p className="text-sm font-medium text-green-600">Added to cart.</p>
      )}
      {status === "error" && error && (
        <p className="text-sm font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}
