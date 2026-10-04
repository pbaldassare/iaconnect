/** Deal stages and deal custom field definitions (settings). Pure, unit tested. */
import type { StageLike } from "./board";

/**
 * Moves a stage one place up or down and returns every stage whose `position`
 * must be written (positions are renumbered 0..n-1, so old gaps and ties disappear).
 * Empty when the stage is unknown or already at the edge and nothing else changes.
 */
export function reorderStages(
  stages: readonly Pick<StageLike, "id" | "position" | "name">[],
  stageId: string,
  direction: "up" | "down",
): { id: string; position: number }[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "it"));
  const index = ordered.findIndex((stage) => stage.id === stageId);
  if (index === -1) return [];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target >= 0 && target < ordered.length) {
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
  }
  return ordered
    .map((stage, position) => ({ id: stage.id, position, previous: stage.position }))
    .filter((stage) => stage.position !== stage.previous)
    .map(({ id, position }) => ({ id, position }));
}

/** Position for a new stage: after every existing one. */
export function nextStagePosition(stages: readonly Pick<StageLike, "position">[]): number {
  return stages.reduce((max, stage) => Math.max(max, stage.position), -1) + 1;
}

/** A stable `key` for a new stage, unique among the existing keys ("In trattativa" → "in_trattativa"). */
export function stageKey(name: string, existing: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "fase";
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** Why the stage set would be unusable after a change, or null. A pipeline needs at least one open stage. */
export function stageSetProblem(stages: readonly Pick<StageLike, "kind">[]): string | null {
  if (!stages.some((stage) => stage.kind === "open")) {
    return "Serve almeno una fase aperta: è lì che entrano le nuove trattative.";
  }
  return null;
}

export const DEAL_FIELD_TYPES = ["text", "number", "date", "boolean"] as const;
export type DealFieldType = (typeof DEAL_FIELD_TYPES)[number];
export const DEAL_FIELD_TYPE_LABELS: Record<DealFieldType, string> = {
  text: "Testo",
  number: "Numero",
  date: "Data",
  boolean: "Sì / No",
};

export interface DealFieldDef {
  key: string;
  label: string;
  type: DealFieldType;
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Reads `org_settings.deal_custom_fields` defensively. */
export function parseDealFieldDefs(value: unknown): DealFieldDef[] {
  if (!Array.isArray(value)) return [];
  const out: DealFieldDef[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.key !== "string" || !KEY.test(record.key)) continue;
    if (out.some((def) => def.key === record.key)) continue;
    const type = (DEAL_FIELD_TYPES as readonly string[]).includes(String(record.type))
      ? (record.type as DealFieldType)
      : "text";
    out.push({
      key: record.key,
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : record.key,
      type,
    });
  }
  return out;
}

/** Rows of the definitions editor → definitions, with Italian errors. Empty rows are skipped. */
export function buildDealFieldDefs(rows: readonly { key: string; label: string; type: string }[]): {
  defs: DealFieldDef[];
  errors: string[];
} {
  const defs: DealFieldDef[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    const rawKey = row.key.trim() || label;
    if (rawKey === "" && label === "") continue;
    const key = rawKey
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    if (!KEY.test(key)) {
      errors.push(`«${rawKey}» non è un nome valido: deve iniziare con una lettera.`);
      continue;
    }
    if (defs.some((def) => def.key === key)) {
      errors.push(`Il campo «${key}» compare due volte.`);
      continue;
    }
    const type = (DEAL_FIELD_TYPES as readonly string[]).includes(row.type)
      ? (row.type as DealFieldType)
      : "text";
    defs.push({ key, label: (label || key).slice(0, 60), type });
  }
  return { defs, errors };
}

/**
 * Values typed in the deal form → the object stored in `deals.custom_fields`.
 * Values of fields that are no longer defined are kept as they are.
 */
export function buildDealCustomFields(
  defs: readonly DealFieldDef[],
  input: Record<string, string | undefined>,
  stored: unknown,
): { fields: Record<string, string | number | boolean>; errors: Record<string, string> } {
  const fields: Record<string, string | number | boolean> = {};
  const errors: Record<string, string> = {};
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      if (defs.some((def) => def.key === key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        fields[key] = value;
    }
  }
  for (const def of defs) {
    const raw = (input[def.key] ?? "").trim();
    if (def.type === "boolean") {
      if (raw === "true" || raw === "on") fields[def.key] = true;
      else if (raw === "false") fields[def.key] = false;
      continue;
    }
    if (raw === "") continue;
    if (def.type === "number") {
      const number = Number(raw.replace(/\./g, "").replace(",", "."));
      const plain = Number(raw.replace(",", "."));
      const value = raw.includes(",") ? number : plain;
      if (!Number.isFinite(value)) errors[def.key] = "Scrivi un numero.";
      else fields[def.key] = value;
    } else if (def.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
        errors[def.key] = "Scegli una data valida.";
      } else fields[def.key] = raw;
    } else fields[def.key] = raw.slice(0, 500);
  }
  return { fields, errors };
}
