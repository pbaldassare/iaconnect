import { type FlowDefinition, FlowDefinitionSchema } from "@ia-connect/core";

/** Small pure helpers for flow versions and runs. Unit tested. */

/** `flow_versions` are insert-only: every change is a new row with the next number. */
export function nextVersionNumber(versions: readonly { version: number }[]): number {
  return versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
}

export type ParsedDefinition =
  | { ok: true; definition: FlowDefinition }
  | { ok: false; message: string; details: string[] };

/** Parses the JSON typed in the manual editor and checks it against the flow schema. */
export function parseDefinitionJson(text: string): ParsedDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: "Il testo non è un JSON valido: controlla virgole, virgolette e parentesi.",
      details: [],
    };
  }
  const parsed = FlowDefinitionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, definition: parsed.data };
  return {
    ok: false,
    message: "La definizione non rispetta lo schema dei flussi.",
    details: parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "flusso"}: ${issue.message}`),
  };
}

export interface FlowRunStats {
  lastRunAt: string | null;
  runs7d: number;
  failed7d: number;
}

const WEEK_MS = 7 * 86_400_000;

/** Per-flow last run and counts over the last 7 days, from recent live runs. */
export function summarizeRuns(
  runs: readonly { flow_id: string; status: string; started_at: string }[],
  now: Date = new Date(),
): Map<string, FlowRunStats> {
  const since = now.getTime() - WEEK_MS;
  const out = new Map<string, FlowRunStats>();
  for (const run of runs) {
    const stats = out.get(run.flow_id) ?? { lastRunAt: null, runs7d: 0, failed7d: 0 };
    if (!stats.lastRunAt || run.started_at > stats.lastRunAt) stats.lastRunAt = run.started_at;
    if (new Date(run.started_at).getTime() >= since) {
      stats.runs7d += 1;
      if (run.status === "failed") stats.failed7d += 1;
    }
    out.set(run.flow_id, stats);
  }
  return out;
}

const STEP_STATUS: Record<string, { label: string; tone: "ok" | "warning" | "error" | "neutral" }> = {
  running: { label: "In corso", tone: "ok" },
  waiting: { label: "In attesa", tone: "neutral" },
  succeeded: { label: "Eseguito", tone: "ok" },
  simulated: { label: "Simulato", tone: "neutral" },
  failed: { label: "Fallito", tone: "error" },
};

export function stepStatus(value: string): { label: string; tone: "ok" | "warning" | "error" | "neutral" } {
  return STEP_STATUS[value] ?? { label: value, tone: "neutral" };
}

/** "1,2 s", "340 ms". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
}

/** Trims the chat history sent by the browser before it reaches the assistant. */
export function sanitizeHistory(
  value: unknown,
  limits: { maxTurns: number; maxChars: number } = { maxTurns: 16, maxChars: 4000 },
): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, limits.maxChars);
    if (text) out.push({ role, content: text });
  }
  return out.slice(-limits.maxTurns);
}
