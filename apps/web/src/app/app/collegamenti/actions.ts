"use server";
import { type ActionResult, fail, failFromError, formToObject, ok } from "@/lib/action";
import { canConnect } from "@/lib/connections/access";
import { connectorErrorMessage, revealableSecrets, webhookExample } from "@/lib/connections/catalog";
import { coerceFormValues, fieldErrorsFromIssues, schemaToFields } from "@/lib/connections/form-fields";
import {
  AccountAlreadyConnectedError,
  connectDeps,
  connectorContext,
  readConnectionSecrets,
  registerWebhook,
  saveConnection,
  writeConnection,
} from "@/lib/connections/server";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo/client";
import { verifyConnectionJob } from "@/lib/job-requests";
import { requestJob } from "@/lib/jobs";
import { isUuid } from "@/lib/org-selection";
import { type OrgContext, actorOf, requireOrgManager } from "@/lib/session";
import { MissingServiceKeyError, createServiceClient, hasServiceKey } from "@/lib/supabase/service";
import { getConnector } from "@ia-connect/connectors";
import type { Row } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ConnectState } from "./state";

const LIST_PATH = "/app/collegamenti";

function refresh(connectionId?: string) {
  revalidatePath(LIST_PATH);
  if (connectionId) revalidatePath(`${LIST_PATH}/${connectionId}`);
}

async function loadConnection(context: OrgContext, connectionId: string): Promise<Row<"connections"> | null> {
  if (!isUuid(connectionId)) return null;
  const { data } = await context.supabase
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  return data;
}

/** Fields the platform fills in by itself and the customer never types. */
const OMITTED_FIELDS = ["code", "redirectUri", "statusCallbackUrl"] as const;

/**
 * Guided connection for `api_key`, `credentials`, `webhook` and `qr` connectors.
 * Secrets arrive in the form body, go to `connector.connect` and to the Vault,
 * and are never sent back (except the generated ones the customer must copy).
 */
export async function connectWithForm(
  connectorKey: string,
  reconnectId: string | null,
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const context = await requireOrgManager();
  if (context.demo) return { status: "error", message: DEMO_READ_ONLY_MESSAGE };
  const connector = getConnector(connectorKey);
  if (!connector || connector.connectMode === "oauth") {
    return { status: "error", message: "Questo tipo di collegamento non si crea da qui." };
  }
  if (!(await canConnect(context, connector.key))) {
    return { status: "error", message: "Questo collegamento non è disponibile per la tua azienda." };
  }
  if (!hasServiceKey()) return { status: "error", message: new MissingServiceKeyError().message };

  const fields = schemaToFields(
    z.toJSONSchema(connector.inputSchema, { io: "input", unrepresentable: "any" }),
    {
      omit: OMITTED_FIELDS,
    },
  );
  const raw = formToObject(formData);
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = raw[field.name];
    if (field.kind === "boolean") values[field.name] = value === "on" ? "on" : "off";
    else if (field.kind !== "password" && typeof value === "string") values[field.name] = value;
  }
  const nameValue = raw.connection_name;
  const name = typeof nameValue === "string" ? nameValue.trim().slice(0, 120) : "";
  if (name) values.connection_name = name;

  const coerced = coerceFormValues(fields, raw);
  if (!coerced.ok) {
    return {
      status: "error",
      message: "Controlla i campi evidenziati.",
      fieldErrors: coerced.fieldErrors,
      values,
    };
  }
  const checked = connector.inputSchema.safeParse(coerced.input);
  if (!checked.success) {
    return {
      status: "error",
      message: "Controlla i campi evidenziati.",
      fieldErrors: fieldErrorsFromIssues(checked.error.issues),
      values,
    };
  }

  let result: Awaited<ReturnType<typeof connector.connect>>;
  try {
    result = await connector.connect(coerced.input, connectDeps());
  } catch (error) {
    return { status: "error", message: connectorErrorMessage(error), values };
  }

  try {
    const saved = await saveConnection(context, {
      connector,
      result,
      name: name || undefined,
      reconnectId: reconnectId && isUuid(reconnectId) ? reconnectId : undefined,
    });
    refresh(saved.connection.id);
    return {
      status: "done",
      connectionId: saved.connection.id,
      name: saved.connection.name,
      message: result.pending
        ? "Collegamento creato: manca solo l'ultimo passaggio qui sotto."
        : reconnectId
          ? "Collegamento aggiornato e di nuovo attivo."
          : "Collegamento creato.",
      webhookUrl: saved.webhookUrl,
      secrets: revealableSecrets(connector.key, coerced.input, result.secrets),
      example:
        connector.key === "webhook_inbound" && saved.webhookUrl ? webhookExample(saved.webhookUrl) : null,
      qr: result.pending?.qr ?? null,
      qrMessage: result.pending?.message ?? null,
      warnings: saved.warnings,
    };
  } catch (error) {
    if (error instanceof AccountAlreadyConnectedError) {
      return { status: "error", message: error.message, values };
    }
    console.error("[connections] save failed", connector.key, (error as { code?: string })?.code ?? "");
    const base = failFromError(error);
    return { status: "error", message: base.ok ? "Operazione non riuscita." : base.message, values };
  }
}

/** Asks the worker to check the connection now; the page shows the outcome when it has run. */
export async function verifyConnectionNow(
  connectionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (context.demo) return fail(DEMO_READ_ONLY_MESSAGE);
  const connection = await loadConnection(context, connectionId);
  if (!connection) return fail("Collegamento non trovato.");
  if (connection.status === "disconnected") return fail("Il collegamento è scollegato: ricollegalo prima.");
  const { error } = await requestJob(context.supabase, {
    organizationId: context.org.organization.id,
    // One request per connection per minute: a double click is harmless.
    ...verifyConnectionJob(connection.id),
    actor: actorOf(context),
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return ok("La verifica è già stata richiesta: l'esito compare qui tra poco.");
    }
    return failFromError(error);
  }
  refresh(connection.id);
  return ok("Verifica richiesta. L'esito compare qui tra poco: ricarica la pagina.");
}

/**
 * Checks the connection right away, from the web server (used while a QR
 * pairing is pending, where waiting for the worker would be confusing).
 */
export async function checkConnectionNow(
  connectionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (context.demo) return fail(DEMO_READ_ONLY_MESSAGE);
  const connection = await loadConnection(context, connectionId);
  if (!connection) return fail("Collegamento non trovato.");
  const connector = getConnector(connection.connector_type);
  if (!connector) return fail("Questo tipo di collegamento non è più disponibile.");
  if (!hasServiceKey()) return fail(new MissingServiceKeyError().message);
  let health: { status: string; message?: string };
  try {
    const service = createServiceClient();
    const secrets = await readConnectionSecrets(service, connection.id);
    health = await connector.verify(connectorContext(service, connection, secrets));
    await writeConnection(service, {
      actorId: context.session.user.id,
      organizationId: context.org.organization.id,
      connectionId: connection.id,
      values: {
        status: health.status,
        last_checked_at: new Date().toISOString(),
        last_error: health.status === "active" ? null : (health.message ?? null),
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code) return failFromError(error);
    return fail(connectorErrorMessage(error));
  }
  refresh(connection.id);
  if (health.status === "active") return ok(health.message ?? "Il collegamento funziona.");
  return fail(health.message ?? "Il collegamento non funziona ancora.");
}

/** Sets the connection to "scollegato" and tells the provider, best effort. */
export async function disconnectConnection(
  connectionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (context.demo) return fail(DEMO_READ_ONLY_MESSAGE);
  const connection = await loadConnection(context, connectionId);
  if (!connection) return fail("Collegamento non trovato.");
  const connector = getConnector(connection.connector_type);
  if (!hasServiceKey()) return fail(new MissingServiceKeyError().message);
  const service = createServiceClient();
  let providerNotified = false;
  if (connector) {
    try {
      const secrets = await readConnectionSecrets(service, connection.id);
      await connector.disconnect(connectorContext(service, connection, secrets));
      providerNotified = true;
    } catch {
      // Best effort: the connection is disconnected on our side anyway.
    }
  }
  try {
    await writeConnection(service, {
      actorId: context.session.user.id,
      organizationId: context.org.organization.id,
      connectionId: connection.id,
      values: { status: "disconnected", last_error: null },
    });
  } catch (error) {
    return failFromError(error);
  }
  refresh(connection.id);
  return ok(
    providerNotified
      ? "Collegamento scollegato. I flussi che lo usano si fermano finché non lo ricolleghi."
      : "Collegamento scollegato qui. Non è stato possibile avvisare il fornitore: se serve, revoca l'accesso anche dal suo sito.",
  );
}

/** Repeats the provider-side webhook registration (Stripe, waWebApi) when it failed at creation. */
export async function registerWebhookAgain(
  connectionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (context.demo) return fail(DEMO_READ_ONLY_MESSAGE);
  const connection = await loadConnection(context, connectionId);
  if (!connection) return fail("Collegamento non trovato.");
  const connector = getConnector(connection.connector_type);
  if (!connector?.actions.registerWebhook)
    return fail("Questo collegamento non ha un webhook da registrare.");
  if (!hasServiceKey()) return fail(new MissingServiceKeyError().message);
  try {
    const service = createServiceClient();
    const secrets = await readConnectionSecrets(service, connection.id);
    const warning = await registerWebhook(service, connector, connection, secrets);
    if (warning)
      return fail("La registrazione del webhook non è riuscita. Controlla le credenziali e riprova.");
  } catch (error) {
    return fail(connectorErrorMessage(error));
  }
  refresh(connection.id);
  return ok("Webhook registrato presso il fornitore.");
}
