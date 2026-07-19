// Route Handler that brokers login/register against the gateway and stores
// the resulting access token in an httpOnly cookie. This is the ONLY place
// in the app that is allowed to see the raw token on the client request path
// -- browser JS never touches it (no localStorage, no client-readable cookie).
import { NextRequest, NextResponse } from "next/server";
import { ApiError, login, logout, register } from "@/lib/api";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/session";

interface SessionRequestBody {
  mode: "login" | "register";
  email: string;
  password: string;
  name?: string;
}

export async function POST(req: NextRequest) {
  let body: SessionRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const { mode, email, password, name } = body;

  if (!email || !password || (mode === "register" && !name)) {
    return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
  }

  try {
    if (mode === "register") {
      await register({ email, password, name: name! });
    }

    const result = await login({ email, password });

    const res = NextResponse.json({ ok: true });
    const isProd = process.env.NODE_ENV === "production";

    res.cookies.set(SESSION_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: result.expiresIn,
    });

    res.cookies.set(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      // Refresh tokens live longer than access tokens (7d per contract);
      // the frontend doesn't act on this yet but stores it for Phase 2.
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    if (err instanceof ApiError) {
      const status = err.status === 0 ? 502 : err.status;
      return NextResponse.json({ message: err.message }, { status });
    }
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      await logout(token);
    } catch {
      // Best-effort: still clear the local cookie even if the gateway call
      // fails (token already expired, gateway briefly down, etc).
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
