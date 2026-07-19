// Route Handler that verifies the admin token against the gateway and, if
// accepted, stores it in an httpOnly cookie. This is the ONLY place in the
// app that is allowed to see the raw token on the client request path --
// browser JS never touches it (no localStorage, no client-readable cookie).
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/api";
import { ADMIN_COOKIE } from "@/lib/session";

interface SessionRequestBody {
  token: string;
}

export async function POST(req: NextRequest) {
  let body: SessionRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ message: "Admin token is required" }, { status: 400 });
  }

  // Per shared/CONTRACTS.md: verify by calling GET /api/admin/inventory?limit=1
  // and checking for a non-403 response.
  const valid = await verifyAdminToken(token);
  if (!valid) {
    return NextResponse.json({ message: "Invalid admin token" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  const isProd = process.env.NODE_ENV === "production";

  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    // Static admin credential, not a short-lived JWT -- keep it around for a
    // normal working session rather than expiring it like an access token.
    maxAge: 60 * 60 * 12,
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
