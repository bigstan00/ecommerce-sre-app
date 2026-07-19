import Link from "next/link";
import { ApiError, getCart } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { formatPrice } from "@/lib/format";
import { enrichCartItems } from "@/lib/enrichCart";
import CartItemsList from "@/components/CartItemsList";
import ClearCartButton from "@/components/ClearCartButton";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const token = getSessionToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in to view your cart."
        action={
          <Link href="/login?next=/cart" className="btn-primary mt-2">
            Log in
          </Link>
        }
      />
    );
  }

  let cart;
  try {
    cart = await getCart(token);
  } catch (err) {
    return (
      <ErrorBanner
        title="Could not load your cart"
        message={err instanceof ApiError ? err.message : "Please try again shortly."}
      />
    );
  }

  if (cart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        message="Browse the catalog and add something you like."
        action={
          <Link href="/" className="btn-primary mt-2">
            Shop products
          </Link>
        }
      />
    );
  }

  const enrichedItems = await enrichCartItems(cart.items);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your cart</h1>
        <ClearCartButton />
      </div>

      <CartItemsList items={enrichedItems} />

      <div className="card ml-auto flex w-full flex-col gap-3 p-6 sm:w-80">
        <div className="flex items-center justify-between text-lg font-bold text-slate-900">
          <span>Total</span>
          <span>{formatPrice(cart.total)}</span>
        </div>
        <Link href="/checkout" className="btn-primary">
          Proceed to checkout
        </Link>
      </div>
    </div>
  );
}
