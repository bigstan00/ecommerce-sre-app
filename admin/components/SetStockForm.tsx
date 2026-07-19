"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import ErrorBanner from "./ErrorBanner";

export default function SetStockForm() {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [available, setAvailable] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, available: Number(available) }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not set stock");
      }

      setSuccess(`Stock for ${productId} set to ${available}.`);
      setProductId("");
      setAvailable("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set stock");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-slate-900">Set stock</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="productId" className="label">
            Product ID
          </label>
          <input
            id="productId"
            required
            className="input"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="Catalog product id"
          />
        </div>

        <div>
          <label htmlFor="available" className="label">
            Available quantity
          </label>
          <input
            id="available"
            type="number"
            step="1"
            min="0"
            required
            className="input"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
          />
        </div>
      </div>

      {error && <ErrorBanner title="Could not set stock" message={error} />}
      {success && (
        <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {success}
        </p>
      )}

      <button type="submit" disabled={loading} className="btn-primary self-start">
        {loading ? "Saving..." : "Set stock"}
      </button>
    </form>
  );
}
