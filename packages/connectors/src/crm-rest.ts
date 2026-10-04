import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  CrmReadInput,
  CrmWriteInput,
  type NormalizedEventInput,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import {
  HEALTHY,
  type HttpOptions,
  errorFromStatus,
  healthFromError,
  parseInput,
  readJson,
  request,
  requireString,
  send,
} from "./lib/http.ts";
import { assertPublicHttpUrl, joinUrl } from "./lib/url.ts";
import { type Json, asArray, asRecord, asString, getPath } from "./lib/values.ts";

const SERVICE = "Gestionale";
/** Ids remembered per watched resource to tell new records from old ones. */
const MAX_SEEN_IDS = 5000;

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
  watch: z.boolean().default(false).describe("Controlla a orari fissi se ci sono nuovi record"),
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

async function list(
  context: ConnectorContext,
  config: Settings,
  resource: Resource,
  query: Record<string, unknown>,
): Promise<Json[]> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  const response = await request(context.fetch, SERVICE, joinUrl(config.baseUrl, resource.listPath), {
    headers: config.headers,
    query: params,
  });
  return extractRecords(await readJson(response), resource);
}

export const crmRestConnector: Connector = {
  key: "crm_rest",
  category: "crm",
  name: "Gestionale (API)",
  description: "Legge e scrive sul gestionale tramite la sua API.",
  connectMode: "api_key",
  inputSchema: CrmRestInput,
  emits: ["crm.record.created"],

  async connect(input, deps) {
    const { authHeaderValue, ...config } = parseInput(CrmRestInput, input);
    assertPublicHttpUrl(config.baseUrl, SERVICE);
    const first = Object.values(config.resources)[0];
    if (first) {
      // Prove the address and the key work before saving anything.
      const response = await request(deps.fetch, SERVICE, joinUrl(config.baseUrl, first.listPath), {
        headers: { [config.authHeaderName]: authHeaderValue },
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
      const response = await send(context.fetch, SERVICE, joinUrl(config.baseUrl, first.listPath), {
        headers: config.headers,
      });
      await response.body?.cancel().catch(() => undefined);
      // Management systems answer 403 as often as 401 when a key is revoked.
      if (response.status === 403) throw errorFromStatus(SERVICE, 401);
      if (!response.ok) throw errorFromStatus(SERVICE, response.status);
      return HEALTHY;
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
      const known = Array.isArray(previous[name]) ? new Set(asArray(previous[name]).map(String)) : undefined;
      const ids: string[] = known ? [...known] : [];
      for (const record of records) {
        const id = asString(record[resource.idField]);
        if (!id) continue;
        // First poll of a resource: remember what exists, emit nothing.
        if (!known) {
          ids.push(id);
          continue;
        }
        if (known.has(id)) continue;
        ids.push(id);
        events.push({
          type: "crm.record.created",
          dedupeKey: `crm_rest:${context.connection.id}:${name}:${id}`.slice(0, 512),
          payload: { resource: name, id, data: record },
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
        const json = asRecord(await readJson(await request(context.fetch, SERVICE, url, options)));
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
