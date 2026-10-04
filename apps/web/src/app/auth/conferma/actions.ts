"use server";
import { completeSignIn } from "@/lib/access";
import { SIGN_IN_PATH, safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/** Called by /auth/conferma once the browser holds a session: accepts invitations, files the access request and moves on. */
export async function finishSignIn(next: string): Promise<void> {
  const supabase = await createClient();
  const destination = await completeSignIn(supabase, safeNextPath(next));
  redirect(destination ?? `${SIGN_IN_PATH}?errore=link`);
}
