// Proxies GET/DELETE /cart to the gateway, attaching the caller's bearer
// token from the httpOnly session cookie. Client Components hit this same
// -origin route instead of the gateway directly, since they cannot read the
// httpOnly cookie themselves.
import { NextResponse } from "next/server";
import { ApiError, clearCart, getCart } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function GET() {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  try {
    const cart = await getCart(token);
    return NextResponse.json(cart);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE() {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  try {
    await clearCart(token);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
