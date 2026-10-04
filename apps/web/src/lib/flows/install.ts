import { CHANNELS, type Channel, type FlowDefinition, FlowDefinitionSchema } from "@ia-connect/core";

/**
 * What installing a library template creates and what is still missing
 * afterwards. Pure, unit tested; the writes are in app/app/flussi/actions.ts.
 */

export interface TemplateRequirements {
  messageTemplates: { channel: Channel; name: string; body: string }[];
  /** Connector categories that must be connected before activation. */
  connections: string[];
  contactFields: string[];
}

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
  return {
    messageTemplates,
    connections: strings(record.connections),
    contactFields: strings(record.contactFields),
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
  /** Nothing left to do before activation (validation still has the last word). */
  ready: boolean;
}

export function planTemplateInstall(
  requirements: TemplateRequirements,
  existing: {
    templates: readonly { channel: string; name: string; approval_status: string }[];
    /** Connections with the category of their connector type. */
    connections: readonly { category: string; status: string }[];
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

  return {
    templatesToCreate,
    templatesAwaitingApproval,
    missingConnections,
    contactFields: requirements.contactFields,
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
