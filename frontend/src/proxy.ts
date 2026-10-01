import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "todo_session";

// Coarse, cookie-presence-only gate: real validation happens on every
// backend request (a stale/invalid cookie gets a 401 there, and the
// client-side API wrapper redirects to /login). This just avoids flashing
// protected pages before that round trip.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|health|favicon.ico).*)"],
};
