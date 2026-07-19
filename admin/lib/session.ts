// Server-only helpers for reading the session cookie set by
// /app/api/session/route.ts. Never import this from a Client Component.
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "admin_token";

/** Reads the admin token from the httpOnly session cookie, if present. */
export function getAdminToken(): string | null {
  return cookies().get(ADMIN_COOKIE)?.value ?? null;
}

export function isLoggedIn(): boolean {
  return getAdminToken() !== null;
}
