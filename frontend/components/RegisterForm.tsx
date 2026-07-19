"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ mode: "register", name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Registration failed");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          autoComplete="name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Creating account..." : "Sign up"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
