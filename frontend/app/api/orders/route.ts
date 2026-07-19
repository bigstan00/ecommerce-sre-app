// Proxies POST /orders to the gateway, attaching the caller's bearer token
// from the httpOnly session cookie. The "Place order" button hits this
// same-origin route instead of the gateway directly, since it cannot read
// the httpOnly cookie itself.
import { NextResponse } from "next/server";
import { ApiError, createOrder } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function POST() {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  try {
    const order = await createOrder(token);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
