"use server";
import { SIGN_IN_PATH, safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/** Called by /auth/conferma once the browser holds a session: accepts invitations and moves on. */
export async function finishSignIn(next: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`${SIGN_IN_PATH}?errore=link`);
  const { error } = await supabase.rpc("accept_invitations");
  if (error) console.error("[auth/conferma] accept_invitations", error.code, error.message);
  redirect(safeNextPath(next));
}
