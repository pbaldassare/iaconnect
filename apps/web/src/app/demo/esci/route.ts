import { DEMO_COOKIE } from "@/lib/routes";
import { NextResponse } from "next/server";

/** Leaves the demo: removes the cookie and goes back to the presentation site. */
export function GET() {
  // A relative Location: the browser stays on the host it used, whatever the server calls itself.
  const response = new NextResponse(null, { status: 307, headers: { Location: "/" } });
  response.cookies.delete(DEMO_COOKIE);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
