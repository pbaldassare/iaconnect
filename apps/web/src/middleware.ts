import {
  DEMO_BLOCKED_PARAM,
  DEMO_BLOCKED_VALUE,
  DEMO_COOKIE,
  DEMO_ENTRY_PATH,
  DEMO_HEADER,
  demoDecision,
  isProtectedPath,
  isSupabaseAuthCookie,
  signInRedirect,
  signedInRedirect,
} from "@/lib/routes";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const NO_INDEX = "noindex, nofollow";

/**
 * Refreshes the Supabase session cookie on every request, sends signed-out
 * visitors of protected areas to /accedi and signed-in visitors of /accedi and
 * /registrati onward to /area-riservata. Authorization (roles, organization)
 * is checked again in the pages through lib/session.ts and, finally, by RLS.
 *
 * Demo: a visitor with the demo cookie and no real session is let into `/app/**` only
 * (`demoDecision` in lib/routes.ts). The middleware is the one place that decides it: it
 * tells the pages through the request header `x-ia-demo`, which it always overwrites, so a
 * header sent by the browser counts for nothing. A demo request never talks to Supabase:
 * when there is no session cookie the client is not even created.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  const hasDemoCookie = request.cookies.get(DEMO_COOKIE)?.value === "1";
  const hasSessionCookie = request.cookies.getAll().some((cookie) => isSupabaseAuthCookie(cookie.name));

  /** Session cookies refreshed by getUser(), to copy onto whatever response is returned. */
  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];
  let signedIn = false;
  if (url && key && (hasSessionCookie || !hasDemoCookie)) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          for (const cookie of toSet) {
            request.cookies.set(cookie.name, cookie.value);
            refreshed.push(cookie);
          }
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = data.user !== null;
  }

  const demo = demoDecision({ pathname, hasDemoCookie, signedIn });
  const finish = (response: NextResponse): NextResponse => {
    for (const { name, value, options } of refreshed) response.cookies.set(name, value, options);
    // A real session always wins: the demo cookie is dropped as soon as one is seen.
    if (signedIn && hasDemoCookie) response.cookies.delete(DEMO_COOKIE);
    if (demo.mode !== "none" || pathname === DEMO_ENTRY_PATH || pathname.startsWith(`${DEMO_ENTRY_PATH}/`)) {
      response.headers.set("X-Robots-Tag", NO_INDEX);
    }
    return response;
  };
  const redirectTo = (target: { pathname: string; search: string }): NextResponse => {
    const destination = request.nextUrl.clone();
    destination.pathname = target.pathname;
    destination.search = target.search;
    return finish(NextResponse.redirect(destination));
  };

  if (demo.mode === "blocked") {
    return redirectTo({
      pathname: demo.redirectTo,
      search: `?${DEMO_BLOCKED_PARAM}=${DEMO_BLOCKED_VALUE}`,
    });
  }
  if (!signedIn && demo.mode !== "demo" && isProtectedPath(pathname)) {
    return redirectTo(signInRedirect(pathname, search));
  }
  // GET only: a server action posted from the sign-in page must reach its handler.
  const onward = signedIn && request.method === "GET" ? signedInRedirect(pathname, search) : null;
  if (onward) return redirectTo(onward);

  // The pages learn about demo mode from this header only; whatever the browser sent is discarded.
  const headers = new Headers(request.headers);
  headers.delete(DEMO_HEADER);
  if (demo.mode === "demo") headers.set(DEMO_HEADER, "1");
  return finish(NextResponse.next({ request: { headers } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
