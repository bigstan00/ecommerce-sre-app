// Proxies POST /admin/inventory to the gateway, attaching the admin token
// from the httpOnly session cookie. The "set stock" form hits this
// same-origin route instead of the gateway directly, since it cannot read
// the httpOnly cookie itself.
import { NextRequest, NextResponse } from "next/server";
import { ApiError, upsertInventory } from "@/lib/api";
import { getAdminToken } from "@/lib/session";
import type { UpsertInventoryRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const token = getAdminToken();
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: Partial<UpsertInventoryRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.productId || body.available === undefined) {
    return NextResponse.json(
      { message: "productId and available are required" },
      { status: 400 }
    );
  }

  try {
    await upsertInventory(token, {
      productId: body.productId,
      available: Number(body.available),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
