"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import ErrorBanner from "./ErrorBanner";

const initialState = {
  name: "",
  description: "",
  price: "",
  category: "",
  imageUrl: "",
  stock: "",
};

export default function CreateProductForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function update<K extends keyof typeof initialState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          price: Number(form.price),
          category: form.category,
          imageUrl: form.imageUrl,
          stock: Number(form.stock),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not create product");
      }

      setForm(initialState);
      setSuccess("Product created.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create product");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-slate-900">Create product</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input
            id="name"
            required
            className="input"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="category" className="label">
            Category
          </label>
          <input
            id="category"
            required
            className="input"
            value={form.category}
            onChange={(e) => update("category", e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="price" className="label">
            Price (USD)
          </label>
          <input
            id="price"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            value={form.price}
            onChange={(e) => update("price", e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="stock" className="label">
            Initial stock
          </label>
          <input
            id="stock"
            type="number"
            step="1"
            min="0"
            required
            className="input"
            value={form.stock}
            onChange={(e) => update("stock", e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="imageUrl" className="label">
            Image URL
          </label>
          <input
            id="imageUrl"
            required
            className="input"
            value={form.imageUrl}
            onChange={(e) => update("imageUrl", e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">
            Description
          </label>
          <textarea
            id="description"
            required
            rows={3}
            className="input"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>
      </div>

      {error && <ErrorBanner title="Could not create product" message={error} />}
      {success && (
        <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {success}
        </p>
      )}

      <button type="submit" disabled={loading} className="btn-primary self-start">
        {loading ? "Creating..." : "Create product"}
      </button>
    </form>
  );
}
