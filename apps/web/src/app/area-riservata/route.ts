import { completeSignIn } from "@/lib/access";
import { SIGN_IN_PATH, safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

/**
 * Entry point of the "Area riservata" button on the presentation site, and the place every
 * "where do I go now?" ends up: signed out → /accedi; signed in → the page the user belongs
 * to (admin area, customer area, waiting page, or the form to ask for access).
 */
export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const supabase = await createClient();
  const destination = await completeSignIn(supabase, next ? safeNextPath(next) : null);
  redirect(destination ?? SIGN_IN_PATH);
}
