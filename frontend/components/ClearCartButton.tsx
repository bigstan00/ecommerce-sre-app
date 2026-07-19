"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ClearCartButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClear() {
    if (!confirm("Remove all items from your cart?")) return;
    setLoading(true);
    try {
      await fetch("/api/cart", { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleClear} disabled={loading} className="btn-secondary">
      {loading ? "Clearing..." : "Clear cart"}
    </button>
  );
}
