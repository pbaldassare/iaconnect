import type { AiService, ExtractField } from "@ia-connect/core";
import { zeroUsage } from "./models.ts";

const FAKE_MODEL = "fake";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fakeValue(field: ExtractField, raw: string | undefined): unknown {
  const value = raw?.trim();
  if (!value) return null;
  switch (field.type) {
    case "number": {
      const parsed = Number(value.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      if (/^(true|s[iì]|yes)$/i.test(value)) return true;
      return /^(false|no)$/i.test(value) ? false : null;
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
    default:
      return value;
  }
}

/** Deterministic, no network: for tests and local development. */
export function createFakeAiService(script: Partial<AiService> = {}): AiService {
  const usage = () => zeroUsage(FAKE_MODEL);
  return {
    /** Reads lines such as `name: Mario Rossi` or `phone = 333…`; everything else is null. */
    async extract(input) {
      const data: Record<string, unknown> = {};
      for (const field of input.fields) {
        const match = new RegExp(`^\\s*${escapeRegExp(field.name)}\\s*[:=]\\s*(.+)$`, "im").exec(input.text);
        data[field.name] = fakeValue(field, match?.[1]);
      }
      const missing = input.fields
        .filter((field) => field.required && data[field.name] === null)
        .map((field) => field.name);
      return { data, missing, usage: usage() };
    },
    async classify(input) {
      return { category: input.categories[0]?.key ?? "", usage: usage() };
    },
    async reply() {
      return {
        text: "Grazie per il messaggio. Questa è una risposta automatica di prova.",
        outcome: "continue",
        usage: usage(),
      };
    },
    async summarize(input) {
      const summary = input.text.trim().split(/\s+/).filter(Boolean).slice(0, input.maxWords).join(" ");
      return { summary, usage: usage() };
    },
    ...script,
  };
}
