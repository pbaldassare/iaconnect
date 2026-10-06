import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  CrmReadInput,
  CrmWriteInput,
  type HostResolver,
  type NormalizedEventInput,
  isKnownEventType,
  normalizePhone,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import {
  AUTH_EXPIRED,
  HEALTHY,
  type HttpOptions,
  errorFromStatus,
  healthFromError,
  parseInput,
  readJson,
  requireString,
  send,
} from "./lib/http.ts";
import { assertPublicHttpUrl, guardedFetch, joinUrl } from "./lib/url.ts";
import { type Json, asArray, asRecord, asString, getPath } from "./lib/values.ts";

const SERVICE = "Gestionale";
/**
 * Ids remembered per watched resource to tell new records from old ones. The cursor lives in
 * `connections.config.cursor` and is rewritten at every poll: 10 000 ids of ~40 characters
 * are about 400 KB, enough for a list of a few thousand records that turns over daily.
 * (The events table has its own `dedupe_key`, so a forgotten id can at most make the
 * platform try again, never write a duplicate.)
 */
const MAX_SEEN_IDS = 10_000;

/**
 * Error codes some management systems (e.g. Assicurapp) put in the body of a 401/403.
 * Only the code is read, never echoed: the messages below are ours.
 */
const KNOWN_ERROR_CODES: Record<string, { message: string; auth: boolean }> = {
  token_revoked: {
    message: "il token API è stato revocato: ricollega il gestionale con un token valido",
    auth: true,
  },
  api_token_required: {
    message: "il gestionale richiede un token API nell'intestazione di autenticazione",
    auth: true,
  },
  scope_not_allowed: {
    message:
      "il token API non ha il permesso di leggere questa risorsa (scope_not_allowed): va abilitato nel gestionale",
    auth: false,
  },
  client_code_mismatch: {
    message: "il codice cliente indicato non corrisponde al token API (client_code_mismatch)",
    auth: false,
  },
};

const ResourceSchema = z.object({
  listPath: z.string().min(1).describe("Percorso per leggere l'elenco (es. /clienti)"),
  createPath: z.string().optional().describe("Percorso per creare un record"),
  updatePath: z
    .string()
    .optional()
    .describe("Percorso per aggiornare un record, con {id} (es. /clienti/{id})"),
  updateMethod: z.enum(["PUT", "PATCH"]).default("PUT").describe("Metodo usato per l'aggiornamento"),
  idField: z.string().default("id").describe("Nome del campo identificativo"),
  recordsPath: z.string().optional().describe("Dove si trova l'elenco nella risposta (es. data.items)"),
  query: z
    .record(z.string(), z.string())
    .optional()
    .describe("Parametri fissi aggiunti all'indirizzo dell'elenco (es. client_code)"),
  watch: z.boolean().default(false).describe("Controlla a orari fissi se ci sono nuovi record"),
  initialPoll: z
    .enum(["ignore", "emit"])
    .default("ignore")
    .describe(
      "Al primo controllo: «ignore» memorizza i record già presenti senza segnalarli, «emit» li segnala tutti",
    ),
  eventType: z
    .string()
    .refine(isKnownEventType, "Tipo di evento sconosciuto")
    .optional()
    .describe("Tipo di evento emesso per i nuovi record, al posto di crm.record.created"),
  contactFields: z
    .object({
      name: z.string().optional().describe("Campo del record con il nome del contatto"),
      phone: z.string().optional().describe("Campo del record con il telefono"),
      email: z.string().optional().describe("Campo del record con la mail"),
    })
    .optional()
    .describe("Campi del record da cui ricavare il contatto dell'evento"),
});
type Resource = z.output<typeof ResourceSchema>;

export const CrmRestInput = z.object({
  baseUrl: z.string().url().describe("Indirizzo di base dell'API del gestionale"),
  authHeaderName: z
    .string()
    .min(1)
    .default("Authorization")
    .describe("Nome dell'intestazione di autenticazione"),
  authHeaderValue: z
    .string()
    .min(1)
    .describe("Valore dell'intestazione (es. Bearer …): viene conservato cifrato"),
  resources: z
    .record(z.string(), ResourceSchema)
    .describe("Risorse del gestionale (clienti, polizze, ordini…)"),
});

interface Settings {
  baseUrl: string;
  headers: Record<string, string>;
  resources: Record<string, Resource>;
}

function settings(context: ConnectorContext): Settings {
  const { config } = context.connection;
  const baseUrl = requireString(config, "baseUrl", SERVICE);
  assertPublicHttpUrl(baseUrl, SERVICE);
  const resources = z.record(z.string(), ResourceSchema).safeParse(config.resources);
  if (!resources.success) {
    throw new ConnectorError(`${SERVICE}: configurazione delle risorse non valida`, {
      retryable: false,
      code: "invalid_connection",
    });
  }
  return {
    baseUrl,
    headers: {
      [asString(config.authHeaderName) ?? "Authorization"]: requireString(
        context.secrets,
        "authHeaderValue",
        SERVICE,
      ),
    },
    resources: resources.data,
  };
}

function resourceOf(all: Record<string, Resource>, name: string): Resource {
  const resource = all[name];
  if (!resource) {
    throw new ConnectorError(`${SERVICE}: risorsa "${name}" non configurata`, {
      retryable: false,
      code: "unknown_resource",
    });
  }
  return resource;
}

function extractRecords(json: unknown, resource: Resource): Json[] {
  const source = resource.recordsPath ? getPath(json, resource.recordsPath) : json;
  if (Array.isArray(source)) return source.map(asRecord);
  return source !== null && typeof source === "object" ? [asRecord(source)] : [];
}

/** The error code a management system wrote in a JSON error body, if it is one we know. */
function knownErrorCode(json: unknown): string | undefined {
  const body = asRecord(json);
  for (const field of ["error", "code", "error_code", "reason", "message"]) {
    const value = body[field];
    const code = typeof value === "string" ? value : asString(asRecord(value).code);
    if (code && code in KNOWN_ERROR_CODES) return code;
  }
  return undefined;
}

/**
 * Maps a failed response to a ConnectorError. A 401, and a 403 that names a revoked or
 * missing token, mean the access is gone (`auth_expired`); a 403 that names a permission
 * or configuration problem is a definitive error with a message the customer can act on.
 */
async function errorFromResponse(response: Response): Promise<ConnectorError> {
  const code =
    response.status === 401 || response.status === 403 ? knownErrorCode(await readJson(response)) : undefined;
  await response.body?.cancel().catch(() => undefined);
  const known = code ? KNOWN_ERROR_CODES[code] : undefined;
  if (known?.auth) {
    return new ConnectorError(`${SERVICE}: ${known.message} (HTTP ${response.status})`, {
      retryable: false,
      code: AUTH_EXPIRED,
      status: response.status,
    });
  }
  if (known && code) {
    return new ConnectorError(`${SERVICE}: ${known.message}`, {
      retryable: false,
      code,
      status: response.status,
    });
  }
  return errorFromStatus(SERVICE, response.status);
}

/** Sends a request and throws the mapped error on a non-2xx status (see `errorFromResponse`). */
async function requestOk(fetchFn: typeof fetch, url: string, options: HttpOptions): Promise<Response> {
  const response = await send(fetchFn, SERVICE, url, options);
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

/**
 * The base address is the customer's: every request checks the host (name and, where the
 * runtime can, DNS) and follows redirects one checked hop at a time, without carrying the
 * authentication header to another origin.
 */
function safeFetch(deps: { fetch: typeof fetch; resolveHost?: HostResolver }): typeof fetch {
  return guardedFetch(deps.fetch, SERVICE, deps.resolveHost);
}

async function list(
  context: ConnectorContext,
  config: Settings,
  resource: Resource,
  query: Record<string, unknown>,
): Promise<Json[]> {
  const params: Record<string, string> = { ...resource.query };
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  const response = await requestOk(safeFetch(context), joinUrl(config.baseUrl, resource.listPath), {
    headers: config.headers,
    query: params,
  });
  return extractRecords(await readJson(response), resource);
}

/** The event's contact hint, read from the fields the resource names. The phone is normalized. */
function contactHint(record: Json, resource: Resource): NormalizedEventInput["contact"] {
  const fields = resource.contactFields;
  if (!fields) return undefined;
  const name = fields.name ? asString(record[fields.name])?.trim() : undefined;
  const rawPhone = fields.phone ? asString(record[fields.phone]) : undefined;
  const phone = rawPhone ? (normalizePhone(rawPhone) ?? undefined) : undefined;
  const email = fields.email ? asString(record[fields.email])?.trim().toLowerCase() : undefined;
  if (!name && !phone && !email) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
}

export const crmRestConnector: Connector = {
  key: "crm_rest",
  category: "crm",
  name: "Gestionale (API)",
  description: "Legge e scrive sul gestionale tramite la sua API.",
  connectMode: "api_key",
  inputSchema: CrmRestInput,
  emits: ["crm.record.created", "policy.expiring", "quote.expiring"],

  async connect(input, deps) {
    const { authHeaderValue, ...config } = parseInput(CrmRestInput, input);
    assertPublicHttpUrl(config.baseUrl, SERVICE);
    const first = Object.values(config.resources)[0];
    if (first) {
      // Prove the address and the key work before saving anything.
      const response = await requestOk(safeFetch(deps), joinUrl(config.baseUrl, first.listPath), {
        headers: { [config.authHeaderName]: authHeaderValue },
        query: first.query,
      });
      await response.body?.cancel().catch(() => undefined);
    }
    return { config, secrets: { authHeaderValue } };
  },

  async verify(context) {
    try {
      const config = settings(context);
      const first = Object.values(config.resources)[0];
      if (!first) return { status: "error", message: "Nessuna risorsa configurata." };
      const response = await send(safeFetch(context), SERVICE, joinUrl(config.baseUrl, first.listPath), {
        headers: config.headers,
        query: first.query,
      });
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return HEALTHY;
      }
      const error = await errorFromResponse(response);
      // Management systems answer 403 as often as 401 when a key is revoked; a 403 that names a
      // permission problem (`scope_not_allowed`…) is a configuration error, not an expired access.
      if (error.options.status === 403 && error.options.code === "http_403")
        throw errorFromStatus(SERVICE, 401);
      throw error;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async poll(context, cursor) {
    const config = settings(context);
    const previous = asRecord(cursor?.seen);
    const seen: Record<string, string[]> = {};
    const events: NormalizedEventInput[] = [];
    for (const [name, resource] of Object.entries(config.resources)) {
      if (!resource.watch) continue;
      const records = await list(context, config, resource, {});
      // "New" means "not among the ids remembered from earlier polls" (there is no "since" API).
      const known = Array.isArray(previous[name]) ? new Set(asArray(previous[name]).map(String)) : undefined;
      // First poll of a resource: with `initialPoll: "ignore"` remember what exists and emit
      // nothing; with `"emit"` every record present is new (a list that is actionable as a whole).
      const emit = known !== undefined || resource.initialPoll === "emit";
      const ids: string[] = known ? [...known] : [];
      for (const record of records) {
        const id = asString(record[resource.idField]);
        if (!id || known?.has(id) || (!known && ids.includes(id))) continue;
        ids.push(id);
        if (!emit) continue;
        const contact = contactHint(record, resource);
        events.push({
          type: resource.eventType ?? "crm.record.created",
          dedupeKey: `crm_rest:${context.connection.id}:${name}:${id}`.slice(0, 512),
          payload: { resource: name, id, data: record },
          ...(contact ? { contact } : {}),
        });
      }
      seen[name] = ids.slice(-MAX_SEEN_IDS);
    }
    return { events, cursor: { seen } };
  },

  actions: {
    read: defineAction({
      key: "read",
      title: "Leggi record dal gestionale",
      input: CrmReadInput,
      async execute(context, input) {
        const config = settings(context);
        const records = await list(
          context,
          config,
          resourceOf(config.resources, input.resource),
          input.query,
        );
        return { records };
      },
    }),
    write: defineAction({
      key: "write",
      title: "Crea o aggiorna un record nel gestionale",
      input: CrmWriteInput,
      async execute(context, input) {
        const config = settings(context);
        const resource = resourceOf(config.resources, input.resource);
        const path = input.id ? resource.updatePath : resource.createPath;
        if (!path) {
          throw new ConnectorError(
            `${SERVICE}: ${input.id ? "aggiornamento" : "creazione"} non configurato per "${input.resource}"`,
            { retryable: false, code: "unsupported" },
          );
        }
        const options: HttpOptions = {
          method: input.id ? resource.updateMethod : "POST",
          headers: config.headers,
          json: input.data,
        };
        const url = joinUrl(config.baseUrl, path.replace("{id}", encodeURIComponent(input.id ?? "")));
        const json = asRecord(await readJson(await requestOk(safeFetch(context), url, options)));
        const id =
          asString(json[resource.idField]) ?? asString(asRecord(json.data)[resource.idField]) ?? input.id;
        if (!id) {
          // The record was written: failing here would make the flow write it again.
          context.logger.warn("crm write response without id", {
            connectionId: context.connection.id,
            resource: input.resource,
          });
        }
        return { id: id ?? "" };
      },
    }),
  },

  async disconnect() {
    // Nothing to revoke: the key is managed inside the management system.
  },
};
