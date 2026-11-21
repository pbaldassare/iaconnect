"use server";

import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { isUuid } from "@/lib/org-selection";
import { newApiKey } from "@/lib/platform-api";
import { requirePlatformAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const PATH = "/admin/api";

const IssueSchema = z.object({
  name: z.string().trim().min(1, "Scrivi un nome.").max(80, "Massimo 80 caratteri."),
  organization_id: z.string().trim(),
});

function issueFailure(error: { code?: string | null; message?: string | null }): ActionResult {
  console.error("[admin/api] issue", error.code, error.message);
  if (error.code === "42501" || error.message === "forbidden") {
    return fail("Solo un amministratore della piattaforma può creare chiavi.");
  }
  if (error.code === "P0002" || error.message === "unknown organization") {
    return fail("Questa azienda non c'è più. Aggiorna la pagina e scegline un'altra.");
  }
  if (error.message === "invalid name") return fail("Il nome deve avere tra 1 e 80 caratteri.");
  return failFromError(error);
}

/** Creates a key and returns it once. The database stores only the hash. */
export async function issueApiKey(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const parsed = parseForm(IssueSchema, formData);
  if (!parsed.ok) return parsed.result;
  const organizationId = parsed.data.organization_id;
  if (organizationId !== "" && !isUuid(organizationId)) {
    return fail("Scegli un'azienda dall'elenco.", { organization_id: "Azienda non valida." });
  }
  const key = await newApiKey();
  const { error } = await supabase.rpc("issue_api_key", {
    p_name: parsed.data.name,
    p_organization: organizationId === "" ? null : organizationId,
    p_prefix: key.prefix,
    p_hash: key.hash,
  });
  if (error) return issueFailure(error);
  revalidatePath(PATH);
  return ok(key.raw);
}

/** Revokes a key. Doing it twice changes nothing. */
export async function revokeApiKey(
  keyId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(keyId)) return fail("Questa chiave non c'è più. Aggiorna la pagina.");
  const { error } = await supabase.rpc("revoke_api_key", { p_key: keyId });
  if (error) {
    console.error("[admin/api] revoke", error.code, error.message);
    if (error.code === "P0002" || error.message === "not found") {
      return fail("Questa chiave non c'è più. Aggiorna la pagina.");
    }
    if (error.code === "42501" || error.message === "forbidden") {
      return fail("Solo un amministratore della piattaforma può revocare chiavi.");
    }
    return failFromError(error);
  }
  revalidatePath(PATH);
  return ok("Chiave revocata. Le chiamate con questa chiave ricevono un rifiuto.");
}
