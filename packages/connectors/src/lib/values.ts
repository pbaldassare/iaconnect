/** Small helpers to read untyped provider JSON without `any`. */

export type Json = Record<string, unknown>;

export function asRecord(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Reads a dot-separated path ("data.items") from a JSON value. */
export function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".").filter(Boolean)) {
    current = asRecord(current)[part];
  }
  return current;
}

/** Removes undefined values so payloads stay compact. */
export function compact<T extends Json>(value: T): T {
  const out: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null && item !== "") out[key] = item;
  }
  return out as T;
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Seconds (or a numeric string of seconds) since the epoch → ISO string. */
export function isoFromEpochSeconds(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}
