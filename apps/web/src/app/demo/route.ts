import { DEFAULT_AFTER_SIGN_IN, DEMO_COOKIE } from "@/lib/routes";
import { type NextRequest, NextResponse } from "next/server";

/** How long a demo visit lasts. */
const DEMO_HOURS = 4;

/**
 * Public entry of the demo: marks the browser with the demo cookie and opens the customer
 * area. Nothing else happens here: no account, no database. The middleware lets the cookie
 * count only under `/app` and only when nobody is signed in (a real session always wins).
 */
export function GET(request: NextRequest) {
  // A relative Location: the browser stays on the host it used, whatever the server calls itself.
  const response = new NextResponse(null, { status: 307, headers: { Location: DEFAULT_AFTER_SIGN_IN } });
  response.cookies.set(DEMO_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    // Behind a proxy the request may look like plain http: trust the forwarded protocol too.
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: DEMO_HOURS * 3600,
  });
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
