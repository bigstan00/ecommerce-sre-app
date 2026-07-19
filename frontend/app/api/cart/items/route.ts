import { NextRequest, NextResponse } from "next/server";
import { ApiError, addCartItem } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: { productId?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.productId || !body.quantity || body.quantity <= 0) {
    return NextResponse.json({ message: "productId and a positive quantity are required" }, { status: 400 });
  }

  try {
    const cart = await addCartItem(token, body.productId, body.quantity);
    return NextResponse.json(cart);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
