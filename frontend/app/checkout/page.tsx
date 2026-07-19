import Link from "next/link";
import { ApiError, getCart } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { formatPrice } from "@/lib/format";
import { enrichCartItems } from "@/lib/enrichCart";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import PlaceOrderButton from "@/components/PlaceOrderButton";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const token = getSessionToken();

  if (!token) {
    return (
      <EmptyState
        title="You're not signed in"
        message="Log in to see your checkout summary."
        action={
          <Link href="/login?next=/checkout" className="btn-primary mt-2">
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
        message="Add items to your cart before checking out."
        action={
          <Link href="/" className="btn-primary mt-2">
            Shop products
          </Link>
        }
      />
    );
  }

  const items = await enrichCartItems(cart.items);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Checkout</h1>

      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold text-slate-900">Order summary</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <li key={item.productId} className="flex items-center justify-between text-slate-600">
              <span>
                {item.quantity} &times; {item.product?.name || `product ${item.productId}`}
              </span>
              <span>{formatPrice(item.priceSnapshot * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3 text-lg font-bold text-slate-900">
          <span>Total</span>
          <span>{formatPrice(cart.total)}</span>
        </div>
      </div>

      <PlaceOrderButton />

      <p className="text-center text-xs text-slate-400">
        Placing your order kicks off the checkout saga — payment and inventory reservation
        happen asynchronously, so your order starts out &quot;pending&quot; and updates from there.
      </p>
    </div>
  );
}
