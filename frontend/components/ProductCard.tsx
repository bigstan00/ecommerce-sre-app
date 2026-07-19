import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export default function ProductCard({ product }: { product: Product }) {
  const outOfStock = product.stock <= 0;

  return (
    <Link
      href={`/products/${product.id}`}
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
    >
      <div className="aspect-square w-full overflow-hidden bg-slate-100">
        {product.imageUrl ? (
          // Using a plain <img> since product image hosts are arbitrary seed
          // data and not known ahead of time for next/image domain config.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
          {product.category}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{product.name}</h3>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-base font-bold text-slate-900">{formatPrice(product.price)}</span>
          {outOfStock ? (
            <span className="text-xs font-medium text-red-500">Out of stock</span>
          ) : (
            <span className="text-xs text-slate-400">{product.stock} in stock</span>
          )}
        </div>
      </div>
    </Link>
  );
}
