import type { z } from "zod";

/**
 * Convention for server actions used with <ActionForm> / useActionState.
 *
 *   "use server";
 *   export async function saveThing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
 *     const { supabase, org } = await requireOrgManager();
 *     const parsed = parseForm(Schema, formData);
 *     if (!parsed.ok) return parsed.result;
 *     const { error } = await supabase.from("things").update(parsed.data).eq("organization_id", org.organization.id);
 *     if (error) return failFromError(error);
 *     revalidatePath("/app/things");
 *     return ok("Salvato.");
 *   }
 *
 * Actions never throw for expected problems: they return `{ ok: false, message }`
 * with an Italian message that says what happened and what to do.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** Initial state for useActionState: nothing happened yet. */
export const IDLE: ActionResult = { ok: true };

export function ok(message?: string): ActionResult {
  return message ? { ok: true, message } : { ok: true };
}

export function fail(message: string, fieldErrors?: Record<string, string>): ActionResult {
  return fieldErrors ? { ok: false, message, fieldErrors } : { ok: false, message };
}

interface ErrorLike {
  code?: string | null;
  message?: string | null;
  name?: string | null;
}

/** Turns a Supabase/Postgres error into a message the customer can act on. */
export function errorMessage(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  const code = e.code ?? "";
  const message = e.message ?? "";
  if (e.name === "MissingServiceKeyError") return message;
  if (code === "PGRST106" || /schema must be one of/i.test(message)) {
    return "Il database non è ancora raggiungibile dall'app: lo schema ia_connect va aggiunto agli «Exposed schemas» nelle impostazioni API di Supabase.";
  }
  if (code === "42501" || /row-level security|not allowed|permission denied/i.test(message)) {
    return "Non hai i permessi per questa operazione.";
  }
  if (code === "23505" && /connections_external_account_unique/.test(message)) {
    return "Questo account è già collegato a un'altra azienda.";
  }
  if (code === "IAC01") {
    return "Ci sono troppe richieste in attesa per la tua azienda: aspetta che le precedenti finiscano e riprova.";
  }
  if (code === "IAC02") {
    return "Il piano non consente altri flussi attivi: metti in pausa un flusso oppure cambia piano.";
  }
  if (/messages cannot be edited/.test(message)) return "Un messaggio già scritto non si può modificare.";
  if (code === "23505") return "Esiste già un elemento con questi dati.";
  if (code === "23503")
    return "Questo elemento è collegato ad altri dati e non può essere modificato o eliminato così.";
  if (code === "23514" || code === "22P02")
    return "Uno dei valori inseriti non è valido. Controlla i campi e riprova.";
  if (code === "P0001") return "Questo dato non si può modificare.";
  if (/fetch failed|network|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return "Il database non risponde. Controlla la connessione e riprova tra poco.";
  }
  return "Operazione non riuscita. Riprova; se succede ancora, contatta l'assistenza.";
}

/** `fail()` from a caught or returned error. Logs the technical detail on the server. */
export function failFromError(error: unknown): ActionResult {
  const e = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  console.error("[action]", e.code ?? "", e.message ?? error);
  return fail(errorMessage(error));
}

/** FormData → plain object. Repeated keys become arrays; files are ignored. */
export function formToObject(formData: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    if (values.length === 1) out[key] = values[0]!;
    else if (values.length > 1) out[key] = values;
  }
  return out;
}

/** Validates a form with a zod schema. On failure returns a ready ActionResult with per-field messages. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.infer<S> } | { ok: false; result: ActionResult } {
  const parsed = schema.safeParse(formToObject(formData));
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, result: fail("Controlla i campi evidenziati.", fieldErrors) };
}
