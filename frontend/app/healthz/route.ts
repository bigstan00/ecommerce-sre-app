// Liveness endpoint per shared/CONTRACTS.md cross-cutting conventions.
// No dependency checks here on purpose -- this only proves the Next.js
// server process is up and serving requests.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
