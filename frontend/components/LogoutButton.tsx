"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      setLoading(false);
      router.push("/");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
