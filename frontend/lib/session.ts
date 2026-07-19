// Server-only helpers for reading the session cookie set by
// /app/api/session/route.ts. Never import this from a Client Component.
import { cookies } from "next/headers";

export const SESSION_COOKIE = "sf_session";
export const REFRESH_COOKIE = "sf_refresh";

/** Reads the access token from the httpOnly session cookie, if present. */
export function getSessionToken(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

export function isLoggedIn(): boolean {
  return getSessionToken() !== null;
}
