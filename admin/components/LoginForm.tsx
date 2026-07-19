"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginForm() {
  const router = useRouter();

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Login failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <label htmlFor="token" className="label">
          Admin token
        </label>
        <input
          id="token"
          type="password"
          required
          autoComplete="off"
          className="input"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste the ADMIN_TOKEN value"
        />
        <p className="mt-1 text-xs text-slate-500">
          Must match the <code>ADMIN_TOKEN</code> configured on the Catalog, Inventory, and
          Order services.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <button type="submit" disabled={loading || !token} className="btn-primary">
        {loading ? "Verifying..." : "Log in"}
      </button>
    </form>
  );
}
