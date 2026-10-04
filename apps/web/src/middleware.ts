import { isProtectedPath, signInRedirect, signedInRedirect } from "@/lib/routes";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request, sends signed-out
 * visitors of protected areas to /accedi and signed-in visitors of /accedi and
 * /registrati onward to /area-riservata. Authorization (roles, organization)
 * is checked again in the pages through lib/session.ts and, finally, by RLS.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  let signedIn = false;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = data.user !== null;
  }

  if (!signedIn && isProtectedPath(pathname)) {
    const target = request.nextUrl.clone();
    const redirectTo = signInRedirect(pathname, search);
    target.pathname = redirectTo.pathname;
    target.search = redirectTo.search;
    return NextResponse.redirect(target);
  }
  // GET only: a server action posted from the sign-in page must reach its handler.
  const onward = signedIn && request.method === "GET" ? signedInRedirect(pathname, search) : null;
  if (onward) {
    const target = request.nextUrl.clone();
    target.pathname = onward.pathname;
    target.search = onward.search;
    const redirect = NextResponse.redirect(target);
    // Keep the session cookies refreshed by getUser() above.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
