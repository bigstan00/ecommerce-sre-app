"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CartItem } from "@/lib/types";
import { formatPrice } from "@/lib/format";

function CartRow({ item }: { item: CartItem }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(item.quantity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateQuantity(nextQuantity: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cart/items/${item.productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: nextQuantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not update quantity");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update quantity");
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cart/items/${item.productId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not remove item");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove item");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-slate-100">
        {item.product?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.product.imageUrl}
            alt={item.product?.name || item.productId}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            No image
          </div>
        )}
      </div>

      <div className="flex-1">
        <Link
          href={`/products/${item.productId}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {item.product?.name || `Product ${item.productId}`}
        </Link>
        <p className="text-sm text-slate-500">{formatPrice(item.priceSnapshot)} each</p>
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <select
          className="input w-20"
          value={quantity}
          disabled={busy}
          onChange={(e) => {
            const next = Number(e.target.value);
            setQuantity(next);
            void updateQuantity(next);
          }}
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <p className="w-20 text-right font-semibold text-slate-900">
          {formatPrice(item.priceSnapshot * item.quantity)}
        </p>

        <button
          onClick={handleRemove}
          disabled={busy}
          className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export default function CartItemsList({ items }: { items: CartItem[] }) {
  return (
    <div className="card divide-y divide-slate-200 p-4 sm:p-6">
      {items.map((item) => (
        <CartRow key={item.productId} item={item} />
      ))}
    </div>
  );
}
