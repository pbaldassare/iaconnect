/**
 * Minimal `{{path.to.value}}` interpolation for flow params.
 * Deterministic and logic-free on purpose: flows cannot contain code.
 */
const EXPRESSION = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}$/;

export type TemplateContext = Record<string, unknown>;

export function getPath(source: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Renders one string. A string that is exactly one expression keeps the value's type. */
export function renderString(input: string, context: TemplateContext): unknown {
  const whole = WHOLE.exec(input);
  if (whole) return getPath(context, whole[1]!);
  return input.replace(EXPRESSION, (_, path: string) => stringify(getPath(context, path)));
}

/** Renders every string found in a JSON-like value. */
export function renderTemplate<T>(value: T, context: TemplateContext): T {
  if (typeof value === "string") return renderString(value, context) as T;
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = renderTemplate(item, context);
    return out as T;
  }
  return value;
}

/** Lists the paths referenced by a JSON-like value, e.g. ["event.payload.phone"]. */
export function listReferences(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(EXPRESSION)) found.add(match[1]!);
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (item && typeof item === "object") {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return [...found];
}
