import { NextRequest, NextResponse } from "next/server";
import { ApiError, removeCartItem, updateCartItem } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function PUT(req: NextRequest, { params }: { params: { productId: string } }) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: { quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.quantity !== "number") {
    return NextResponse.json({ message: "quantity is required" }, { status: 400 });
  }

  try {
    const cart = await updateCartItem(token, params.productId, body.quantity);
    return NextResponse.json(cart);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { productId: string } }) {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  try {
    const cart = await removeCartItem(token, params.productId);
    return NextResponse.json(cart);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
