// Proxies POST /admin/products to the gateway, attaching the admin token
// from the httpOnly session cookie. The "create product" form hits this
// same-origin route instead of the gateway directly, since it cannot read
// the httpOnly cookie itself.
import { NextRequest, NextResponse } from "next/server";
import { ApiError, createProduct } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import type { CreateProductRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const token = getAdminToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: Partial<CreateProductRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body.name ||
    !body.description ||
    body.price === undefined ||
    !body.category ||
    !body.imageUrl ||
    body.stock === undefined
  ) {
    return NextResponse.json(
      { message: "name, description, price, category, imageUrl, and stock are required" },
      { status: 400 }
    );
  }

  try {
    const result = await createProduct(token, {
      name: body.name,
      description: body.description,
      price: Number(body.price),
      category: body.category,
      imageUrl: body.imageUrl,
      stock: Number(body.stock),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
