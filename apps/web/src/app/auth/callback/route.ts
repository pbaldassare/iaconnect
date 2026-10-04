import { completeSignIn } from "@/lib/access";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/url";
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

const OTP_TYPES: readonly string[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing point of the links sent by mail (magic link, invitation, sign-up
 * confirmation, password reset). Handles the PKCE `code`, the `token_hash`
 * variant, and hands links that carry the session in the URL fragment
 * (invitations) to /auth/conferma. After sign-in, pending invitations become
 * memberships, the registration data becomes an access request, and the user
 * is sent where they belong (lib/access.ts).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const base = await appUrl();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (!code && !tokenHash) {
    // The fragment (#access_token=…) never reaches the server: the browser keeps it across this redirect.
    return NextResponse.redirect(`${base}/auth/conferma?next=${encodeURIComponent(next)}`);
  }

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : type && OTP_TYPES.includes(type)
      ? await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash! })
      : { error: new Error("unknown link type") };
  if (error) {
    console.error("[auth/callback]", error.message);
    return NextResponse.redirect(`${base}/accedi?errore=link`);
  }

  const wanted = type === "invite" || type === "recovery" ? "/imposta-password" : next;
  const destination = (await completeSignIn(supabase, wanted)) ?? "/accedi?errore=link";
  return NextResponse.redirect(`${base}${destination}`);
}
