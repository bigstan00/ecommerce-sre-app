import Link from "next/link";
import { ApiError, getInventory } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import SetStockForm from "@/components/SetStockForm";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function InventoryPage() {
  const token = getAdminToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in with the admin token to manage inventory."
        action={
          <Link href="/login" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let inventoryError: string | null = null;
  let inventory: Awaited<ReturnType<typeof getInventory>> = {
    items: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
  };

  try {
    inventory = await getInventory(token, { limit: PAGE_SIZE });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      inventoryError = "Admin token was rejected by the Inventory service. Log in again.";
    } else {
      inventoryError =
        err instanceof ApiError ? err.message : "Failed to load inventory. Please try again.";
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
        <p className="mt-1 text-sm text-slate-500">
          Stock levels tracked by the Inventory service, keyed by product ID.
        </p>
      </div>

      <SetStockForm />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Stock levels {inventory.total > 0 && `(${inventory.total})`}
        </h2>

        {inventoryError ? (
          <ErrorBanner title="Could not load inventory" message={inventoryError} />
        ) : inventory.items.length === 0 ? (
          <EmptyState
            title="No stock records yet"
            message="Set stock for a product using the form above."
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product ID</th>
                  <th className="px-4 py-3">Available</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.items.map((item) => (
                  <tr key={item.productId}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {item.productId}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.available <= 0 ? (
                        <span className="font-medium text-red-600">0 (out of stock)</span>
                      ) : (
                        item.available
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {item.updatedAt ? formatDateTime(item.updatedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
