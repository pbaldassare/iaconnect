/**
 * Message templates use numbered placeholders — `{{1}}`, `{{2}}` — the format
 * WhatsApp requires. Pure, unit tested.
 */
const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** Placeholder numbers used in the text, ascending and without repetitions. */
export function placeholderIndexes(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    for (const match of (text ?? "").matchAll(PLACEHOLDER)) {
      const index = Number(match[1]);
      if (index >= 1) found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** How many variables the worker must receive: the highest placeholder number. */
export function variableCount(...texts: (string | null | undefined)[]): number {
  const indexes = placeholderIndexes(...texts);
  return indexes.length === 0 ? 0 : indexes[indexes.length - 1]!;
}

/**
 * Replaces `{{n}}` with `variables[n - 1]`. A missing or empty value keeps the
 * placeholder visible, so a preview shows what still has to be filled in.
 */
export function renderTemplate(text: string | null | undefined, variables: readonly string[]): string {
  return (text ?? "").replace(PLACEHOLDER, (whole, raw: string) => {
    const value = variables[Number(raw) - 1];
    return value !== undefined && value.trim() !== "" ? value.trim() : whole;
  });
}

const SAMPLES = ["Maria Rossi", "martedì alle 15:00", "Agenzia Bianchi", "02 1234567", "€ 250"];

/** Sample values for the live preview in the template editor. */
export function sampleVariables(count: number): string[] {
  return Array.from({ length: count }, (_, i) => SAMPLES[i] ?? `Valore ${i + 1}`);
}

/** Placeholders must be numbered 1..n without holes (a WhatsApp rule): returns the missing numbers. */
export function missingPlaceholders(...texts: (string | null | undefined)[]): number[] {
  const indexes = new Set(placeholderIndexes(...texts));
  const max = variableCount(...texts);
  const missing: number[] = [];
  for (let i = 1; i <= max; i++) if (!indexes.has(i)) missing.push(i);
  return missing;
}

/** Checks the values an operator typed for a template; returns an Italian error or null. */
export function checkVariables(body: string, variables: readonly string[]): string | null {
  const count = variableCount(body);
  for (let i = 0; i < count; i++) {
    if (!variables[i] || variables[i]!.trim() === "") return `Compila il valore ${i + 1} del modello.`;
  }
  return null;
}

/**
 * Language code of a template as the provider expects it: "it", "en_US", "pt_BR".
 * The worker passes `message_templates.language` to WhatsApp as it is, and Meta's codes are
 * case sensitive: the language is lower case, the region upper case. Null when it is not a code.
 */
export function normalizeTemplateLanguage(input: string | null | undefined): string | null {
  const match = /^([a-z]{2,3})(?:[_-]([a-z]{2}))?$/i.exec((input ?? "").trim());
  if (!match) return null;
  return match[2] ? `${match[1]!.toLowerCase()}_${match[2].toUpperCase()}` : match[1]!.toLowerCase();
}
