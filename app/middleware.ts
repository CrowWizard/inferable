import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Clerk middleware removed — all routes are public in self-hosted mode.
export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next).*)", "/", "/api/:path*"],
};
