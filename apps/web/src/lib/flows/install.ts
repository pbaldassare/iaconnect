import { CHANNELS, type Channel, type FlowDefinition, FlowDefinitionSchema } from "@ia-connect/core";
import { DEAL_FIELD_TYPES, type DealFieldDef, type DealFieldType } from "../deals/stages";

/**
 * What installing a library template creates and what is still missing
 * afterwards. Pure, unit tested; the writes are in app/app/flussi/actions.ts.
 */

export interface TemplateRequirements {
  messageTemplates: { channel: Channel; name: string; body: string }[];
  /** Connector categories that must be connected before activation. */
  connections: string[];
  contactFields: string[];
  /** Deal stages the flow uses: created when missing, after the last open stage. */
  stages: { key: string; name: string; kind: "open" }[];
  /** Deal custom fields the flow writes: added to the organization's definitions when missing. */
  dealFields: DealFieldDef[];
}

const STAGE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
}

/** Reads `flow_templates.requirements` defensively: anything malformed is dropped. */
export function parseRequirements(value: unknown): TemplateRequirements {
  const record =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const messageTemplates: TemplateRequirements["messageTemplates"] = [];
  for (const item of Array.isArray(record.messageTemplates) ? record.messageTemplates : []) {
    if (!item || typeof item !== "object") continue;
    const { channel, name, body } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name || typeof body !== "string" || !body) continue;
    if (!CHANNELS.includes(channel as Channel)) continue;
    messageTemplates.push({ channel: channel as Channel, name, body });
  }
  const stages: TemplateRequirements["stages"] = [];
  for (const item of Array.isArray(record.stages) ? record.stages : []) {
    if (!item || typeof item !== "object") continue;
    const { key, name } = item as Record<string, unknown>;
    if (typeof key !== "string" || !STAGE_KEY.test(key) || typeof name !== "string" || !name.trim()) continue;
    if (stages.some((stage) => stage.key === key)) continue;
    // Only open stages can be asked for: a template never decides what "won" or "lost" means.
    stages.push({ key, name: name.trim().slice(0, 60), kind: "open" });
  }
  const dealFields: DealFieldDef[] = [];
  for (const item of Array.isArray(record.dealFields) ? record.dealFields : []) {
    if (!item || typeof item !== "object") continue;
    const { key, label, type } = item as Record<string, unknown>;
    if (typeof key !== "string" || !STAGE_KEY.test(key)) continue;
    if (dealFields.some((field) => field.key === key)) continue;
    dealFields.push({
      key,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : key,
      type: (DEAL_FIELD_TYPES as readonly string[]).includes(String(type)) ? (type as DealFieldType) : "text",
    });
  }
  return {
    messageTemplates,
    connections: strings(record.connections),
    contactFields: strings(record.contactFields),
    stages,
    dealFields,
  };
}

/** The template's definition, or null when it does not pass the flow schema. */
export function parseTemplateDefinition(value: unknown): FlowDefinition | null {
  const parsed = FlowDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface InstallPlan {
  /** Message templates to insert as drafts (not present yet for that channel and name). */
  templatesToCreate: TemplateRequirements["messageTemplates"];
  /** Required message templates that will exist after installation but are not approved. */
  templatesAwaitingApproval: { channel: Channel; name: string; status: string }[];
  /** Required categories without an active connection. `existing` = there is one, but not active. */
  missingConnections: { category: string; existing: boolean }[];
  /** Custom contact fields the flow reads: the customer must fill them on the contacts. */
  contactFields: string[];
  /** Deal stages to insert, with their position; empty when `existing.stages` was not given. */
  stagesToCreate: { key: string; name: string; kind: "open"; position: number }[];
  /** Existing stages whose position must change to leave room for the new ones (won/lost move after). */
  stagesToMove: { id: string; position: number }[];
  /** Deal custom field definitions to append to `org_settings.deal_custom_fields`. */
  dealFieldsToCreate: DealFieldDef[];
  /** Nothing left to do before activation (validation still has the last word). */
  ready: boolean;
}

/**
 * Where the stages a template needs go: after the last open stage, before won and lost,
 * which are pushed down. Positions are renumbered 0..n-1 like `reorderStages` does.
 */
export function placeNewStages(
  existing: readonly { id: string; key: string; position: number; kind: string }[],
  wanted: readonly { key: string; name: string; kind: "open" }[],
): Pick<InstallPlan, "stagesToCreate" | "stagesToMove"> {
  const missing = wanted.filter((stage) => !existing.some((item) => item.key === stage.key));
  if (missing.length === 0) return { stagesToCreate: [], stagesToMove: [] };
  const ordered = [...existing].sort((a, b) => a.position - b.position);
  const open = ordered.filter((stage) => stage.kind === "open");
  const closed = ordered.filter((stage) => stage.kind !== "open");
  const sequence: ({ id: string; position: number } | { key: string; name: string; kind: "open" })[] = [
    ...open,
    ...missing,
    ...closed,
  ];
  const stagesToCreate: InstallPlan["stagesToCreate"] = [];
  const stagesToMove: InstallPlan["stagesToMove"] = [];
  sequence.forEach((item, position) => {
    if ("id" in item) {
      if (item.position !== position) stagesToMove.push({ id: item.id, position });
    } else stagesToCreate.push({ ...item, position });
  });
  return { stagesToCreate, stagesToMove };
}

export function planTemplateInstall(
  requirements: TemplateRequirements,
  existing: {
    templates: readonly { channel: string; name: string; approval_status: string }[];
    /** Connections with the category of their connector type. */
    connections: readonly { category: string; status: string }[];
    /** Deal stages of the organization; when omitted, no stage is planned. */
    stages?: readonly { id: string; key: string; position: number; kind: string }[];
    /** Deal custom field definitions of the organization; when omitted, no field is planned. */
    dealFields?: readonly { key: string }[];
  },
): InstallPlan {
  const templatesToCreate: InstallPlan["templatesToCreate"] = [];
  const templatesAwaitingApproval: InstallPlan["templatesAwaitingApproval"] = [];
  const seen = new Set<string>();
  for (const wanted of requirements.messageTemplates) {
    const key = `${wanted.channel}:${wanted.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const found = existing.templates.find(
      (item) => item.channel === wanted.channel && item.name === wanted.name,
    );
    if (!found) {
      templatesToCreate.push(wanted);
      templatesAwaitingApproval.push({ channel: wanted.channel, name: wanted.name, status: "draft" });
    } else if (found.approval_status !== "approved") {
      templatesAwaitingApproval.push({
        channel: wanted.channel,
        name: wanted.name,
        status: found.approval_status,
      });
    }
  }

  const missingConnections: InstallPlan["missingConnections"] = [];
  for (const category of new Set(requirements.connections)) {
    const ofCategory = existing.connections.filter((item) => item.category === category);
    if (ofCategory.some((item) => item.status === "active")) continue;
    missingConnections.push({
      category,
      existing: ofCategory.some((item) => item.status !== "disconnected"),
    });
  }

  const placed = existing.stages
    ? placeNewStages(existing.stages, requirements.stages)
    : { stagesToCreate: [], stagesToMove: [] };
  const dealFieldsToCreate = existing.dealFields
    ? requirements.dealFields.filter((field) => !existing.dealFields!.some((item) => item.key === field.key))
    : [];

  return {
    templatesToCreate,
    templatesAwaitingApproval,
    missingConnections,
    contactFields: requirements.contactFields,
    ...placed,
    dealFieldsToCreate,
    ready: templatesAwaitingApproval.length === 0 && missingConnections.length === 0,
  };
}

/** Library order: the organization's sector first, then the others; by name inside each group. */
export function sortTemplatesForSector<T extends { sector: string; name: string }>(
  templates: readonly T[],
  sector: string,
): T[] {
  return [...templates].sort((a, b) => {
    const own = Number(b.sector === sector) - Number(a.sector === sector);
    return own !== 0 ? own : a.sector.localeCompare(b.sector) || a.name.localeCompare(b.name, "it");
  });
}
