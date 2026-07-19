import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, getProduct } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import AddToCartButton from "@/components/AddToCartButton";
import ErrorBanner from "@/components/ErrorBanner";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  let product;
  try {
    product = await getProduct(params.id);
  } catch (err) {
    return (
      <ErrorBanner
        title="Could not load this product"
        message={err instanceof ApiError ? err.message : "Please try again shortly."}
      />
    );
  }

  if (!product) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
        &larr; Back to products
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-lg bg-slate-100">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-400">
              No image available
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
              {product.category}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{product.name}</h1>
          </div>

          <p className="text-3xl font-bold text-slate-900">{formatPrice(product.price)}</p>

          <p className="leading-relaxed text-slate-600">{product.description}</p>

          <p className="text-sm text-slate-500">
            {product.stock > 0 ? `${product.stock} in stock` : "Currently out of stock"}
          </p>

          <div className="mt-2 max-w-xs">
            <AddToCartButton productId={product.id} maxQuantity={product.stock} />
          </div>
        </div>
      </div>
    </div>
  );
}
