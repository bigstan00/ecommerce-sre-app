import { ApiError, getCategories, getProducts } from "@/lib/api";
import type { ProductListResponse } from "@/lib/types";
import ProductCard from "@/components/ProductCard";
import CategoryFilter from "@/components/CategoryFilter";
import Pagination from "@/components/Pagination";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

interface HomePageProps {
  searchParams: { category?: string; page?: string };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const category = searchParams.category || undefined;
  const page = Math.max(1, Number(searchParams.page) || 1);

  let productsError: string | null = null;
  let categoriesError: string | null = null;
  let productList: ProductListResponse = { items: [], total: 0, page, limit: PAGE_SIZE };
  let categories: string[] = [];

  try {
    productList = await getProducts({ category, page, limit: PAGE_SIZE });
  } catch (err) {
    productsError =
      err instanceof ApiError ? err.message : "Failed to load products. Please try again.";
  }

  try {
    categories = await getCategories();
  } catch (err) {
    categoriesError =
      err instanceof ApiError ? err.message : "Failed to load categories.";
  }

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Shop products</h1>
        <p className="mt-1 text-sm text-slate-500">Browse the full catalog, filter by category.</p>
      </div>

      {categoriesError ? (
        <ErrorBanner title="Categories unavailable" message={categoriesError} />
      ) : (
        categories.length > 0 && <CategoryFilter categories={categories} selected={category} />
      )}

      {productsError ? (
        <ErrorBanner title="Could not load products" message={productsError} />
      ) : productList.items.length === 0 ? (
        <EmptyState
          title="No products found"
          message={
            category
              ? `No products in the "${category}" category yet.`
              : "The catalog is empty right now."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {productList.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          <Pagination
            page={productList.page}
            limit={productList.limit}
            total={productList.total}
            buildHref={buildHref}
          />
        </>
      )}
    </div>
  );
}
