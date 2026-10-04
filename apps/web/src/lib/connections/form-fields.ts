/**
 * Turns a connector's input schema (as JSON Schema, from `z.toJSONSchema`) into
 * form fields, and the submitted form back into the object `connect` expects.
 * Pure, unit tested.
 */

export type FieldKind =
  | "text"
  | "password"
  | "url"
  | "email"
  | "number"
  | "boolean"
  | "select"
  | "list"
  | "json";

export interface FormField {
  name: string;
  /** From the schema's `.describe()` text; the field name when missing. */
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Never set for secret fields. */
  defaultValue?: string;
  options?: string[];
  /** For `list`: whether the items are numbers. */
  numericItems?: boolean;
}

/** Field names that hold credentials: rendered as password inputs and never echoed back. */
const SECRET_NAME = /(secret|token|password|passwd|apikey|api_key|key$|headervalue|credential)/i;

export function isSecretField(name: string): boolean {
  return SECRET_NAME.test(name);
}

type Schema = Record<string, unknown>;

function asSchema(value: unknown): Schema {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Schema) : {};
}

/** Unwraps `anyOf: [X, null]` (optional or nullable values) to X. */
function unwrap(schema: Schema): Schema {
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (!variants) return schema;
  const real = variants.map(asSchema).find((item) => item.type !== "null");
  return real
    ? { ...real, description: schema.description ?? real.description, default: schema.default }
    : schema;
}

function kindOf(name: string, schema: Schema): Pick<FormField, "kind" | "options" | "numericItems"> {
  if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === "string")) {
    return { kind: "select", options: schema.enum as string[] };
  }
  switch (schema.type) {
    case "boolean":
      return { kind: "boolean" };
    case "number":
    case "integer":
      return { kind: "number" };
    case "array": {
      const items = asSchema(schema.items);
      if (items.type === "string") return { kind: "list" };
      if (items.type === "number" || items.type === "integer") return { kind: "list", numericItems: true };
      return { kind: "json" };
    }
    case "object":
      return { kind: "json" };
    case "string":
      if (isSecretField(name)) return { kind: "password" };
      if (schema.format === "uri") return { kind: "url" };
      if (schema.format === "email") return { kind: "email" };
      return { kind: "text" };
    default:
      return isSecretField(name) ? { kind: "password" } : { kind: "json" };
  }
}

function defaultText(kind: FieldKind, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (kind === "password") return undefined;
  if (kind === "json") return JSON.stringify(value, null, 2);
  if (kind === "list") return Array.isArray(value) ? value.join(", ") : undefined;
  if (kind === "boolean") return value === true ? "true" : "false";
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/**
 * Form fields for an object schema. `omit` hides fields the platform fills in
 * by itself (the OAuth `code`, the webhook address).
 */
export function schemaToFields(jsonSchema: unknown, options: { omit?: readonly string[] } = {}): FormField[] {
  const root = asSchema(jsonSchema);
  const properties = asSchema(root.properties);
  const required = new Set(Array.isArray(root.required) ? root.required.map(String) : []);
  const omit = new Set(options.omit ?? []);
  const fields: FormField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (omit.has(name)) continue;
    const schema = unwrap(asSchema(raw));
    const shape = kindOf(name, schema);
    const hasDefault = schema.default !== undefined;
    fields.push({
      name,
      label: typeof schema.description === "string" && schema.description ? schema.description : name,
      required: required.has(name) && !hasDefault,
      defaultValue: defaultText(shape.kind, schema.default),
      ...shape,
    });
  }
  return fields;
}

export type CoercedInput =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Submitted strings → typed input. Empty optional fields are left out, so the
 * connector's own defaults apply.
 */
export function coerceFormValues(
  fields: readonly FormField[],
  values: Record<string, string | string[] | undefined>,
): CoercedInput {
  const input: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name];
    const text = (Array.isArray(raw) ? (raw[raw.length - 1] ?? "") : (raw ?? "")).trim();

    if (field.kind === "boolean") {
      // An unticked checkbox sends nothing: the hidden companion field tells us the form had it.
      input[field.name] = text === "on" || text === "true";
      continue;
    }
    if (text === "") {
      if (field.required) fieldErrors[field.name] = "Questo campo è obbligatorio.";
      continue;
    }
    switch (field.kind) {
      case "number": {
        const number = Number(text.replace(",", "."));
        if (Number.isFinite(number)) input[field.name] = number;
        else fieldErrors[field.name] = "Scrivi un numero.";
        break;
      }
      case "list": {
        const items = text
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
        if (!field.numericItems) {
          input[field.name] = items;
          break;
        }
        const numbers = items.map(Number);
        if (numbers.every(Number.isFinite)) input[field.name] = numbers;
        else fieldErrors[field.name] = "Scrivi solo numeri, separati da virgola.";
        break;
      }
      case "json":
        try {
          input[field.name] = JSON.parse(text);
        } catch {
          fieldErrors[field.name] = "Non è un JSON valido: controlla virgole, virgolette e parentesi.";
        }
        break;
      case "select":
        if (field.options?.includes(text)) input[field.name] = text;
        else fieldErrors[field.name] = "Scegli uno dei valori proposti.";
        break;
      default:
        input[field.name] = text;
    }
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, input };
}

/** Per-field messages from a failed `inputSchema.safeParse`, in Italian and without echoing values. */
export function fieldErrorsFromIssues(
  issues: readonly { path: readonly PropertyKey[]; code?: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (!key || out[key]) continue;
    out[key] =
      issue.code === "invalid_type"
        ? "Questo campo è obbligatorio o ha un formato sbagliato."
        : "Valore non valido: controlla il formato richiesto.";
  }
  return out;
}
