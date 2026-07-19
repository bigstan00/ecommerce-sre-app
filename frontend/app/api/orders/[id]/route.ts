// Proxies GET /orders/:id to the gateway, attaching the caller's bearer
// token from the httpOnly session cookie. The order status page polls this
// same-origin route from the client, since it cannot read the httpOnly
// cookie itself.
import { NextRequest, NextResponse } from "next/server";
import { ApiError, getOrder } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  try {
    const order = await getOrder(token, params.id);
    if (!order) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
