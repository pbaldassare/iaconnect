const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses "30m", "48h", "2d" into milliseconds. Throws on anything else. */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
  if (!match) throw new Error(`Invalid duration "${input}": expected a number followed by s, m, h or d`);
  return Number(match[1]) * UNITS[match[2]!]!;
}

export function isDuration(input: unknown): input is string {
  return typeof input === "string" && /^(\d+)\s*([smhd])$/.test(input.trim());
}
