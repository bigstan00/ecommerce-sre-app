import Link from "next/link";
import { ApiError, getProducts } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import { formatPrice } from "@/lib/format";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import CreateProductForm from "@/components/CreateProductForm";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage() {
  const token = getAdminToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in with the admin token to manage products."
        action={
          <Link href="/login" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let productsError: string | null = null;
  let products: Awaited<ReturnType<typeof getProducts>> = {
    items: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
  };

  try {
    products = await getProducts({ limit: PAGE_SIZE });
  } catch (err) {
    productsError =
      err instanceof ApiError ? err.message : "Failed to load products. Please try again.";
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Products</h1>
        <p className="mt-1 text-sm text-slate-500">
          Read from the public catalog listing; creation goes through the admin-gated endpoint.
        </p>
      </div>

      <CreateProductForm />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          All products {products.total > 0 && `(${products.total})`}
        </h2>

        {productsError ? (
          <ErrorBanner title="Could not load products" message={productsError} />
        ) : products.items.length === 0 ? (
          <EmptyState title="No products yet" message="Create one using the form above." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Product ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.items.map((product) => (
                  <tr key={product.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{product.name}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{product.category}</td>
                    <td className="px-4 py-3 text-slate-600">{formatPrice(product.price)}</td>
                    <td className="px-4 py-3 text-slate-600">{product.stock}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{product.id}</td>
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
