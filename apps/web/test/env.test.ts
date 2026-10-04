/**
 * `.env.example` is the list of environment variables of the whole repository: every
 * variable the code reads is there once, with a comment saying who reads it, and without a value
 * that could be a secret.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONNECTOR_ENV_KEYS } from "../src/lib/connections/catalog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", "test", "public"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith(".gen.ts")) out.push(path);
  }
  return out;
}

/**
 * Names read from the environment: `process.env.X`, `env.X` (the worker's alias of
 * `process.env`, connector contexts), `env("X")` (packages/ai), `Deno.env.get("X")`,
 * `requireEnv(…, "X")` and the `…Env: "X"` settings of the OAuth helpers.
 */
function readVariables(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const patterns = [
    /\b(?:process\.env|env)\.([A-Z][A-Z0-9_]{2,})\b/g,
    /\b(?:process\.env|env)\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
    /\benv(?:\.get)?\(\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\)/g,
    /\brequireEnv\([^,()]+,\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
    /\b\w+Env:\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
  ];
  const roots = [
    "apps/web/src",
    "apps/web/next.config.ts",
    "apps/worker/src",
    "packages",
    "supabase/functions",
    "scripts",
  ];
  for (const root of roots) {
    const path = join(ROOT, root);
    const files = statSync(path).isDirectory() ? sourceFiles(path) : [path];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          // `NEXT_PUBLIC_*` in a comment is not a name.
          if (match[1]!.endsWith("_")) continue;
          const list = found.get(match[1]!) ?? [];
          list.push(relative(ROOT, file));
          found.set(match[1]!, list);
        }
      }
    }
  }
  for (const key of CONNECTOR_ENV_KEYS)
    found.set(key, [...(found.get(key) ?? []), "apps/web (connectorEnv)"]);
  return found;
}

/** Set by the runtime, not by whoever deploys. */
const RUNTIME = new Set(["NODE_ENV"]);
/** Older spellings the worker still accepts (apps/worker/src/main.ts): documented names are AI_MODEL_*. */
const LEGACY_ALIASES = new Set(["AI_SMART_MODEL", "AI_FAST_MODEL"]);

interface Entry {
  name: string;
  value: string;
  comment: string;
}

function exampleEntries(): Entry[] {
  const entries: Entry[] = [];
  let comment: string[] = [];
  for (const line of readFileSync(join(ROOT, ".env.example"), "utf8").split("\n")) {
    if (line.startsWith("#")) comment.push(line.replace(/^#\s?/, ""));
    else if (line.trim() === "") comment = [];
    else {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match) throw new Error(`.env.example: line not understood: ${line}`);
      entries.push({ name: match[1]!, value: match[2]!, comment: comment.join(" ") });
      comment = [];
    }
  }
  return entries;
}

describe(".env.example", () => {
  const entries = exampleEntries();
  const read = readVariables();

  it("lists every variable the code reads, and nothing else", () => {
    const expected = [...read.keys()]
      .filter((name) => !RUNTIME.has(name) && !LEGACY_ALIASES.has(name))
      .sort();
    expect(entries.map((entry) => entry.name).sort()).toEqual(expected);
    // The scan really found the readers on every side.
    expect(read.get("DATABASE_URL")?.some((file) => file.startsWith("apps/worker"))).toBe(true);
    expect(read.get("APP_URL")?.some((file) => file.startsWith("apps/web"))).toBe(true);
    expect(read.get("SUPABASE_URL")?.some((file) => file.startsWith("supabase/functions"))).toBe(true);
    expect(read.get("AI_MODEL_FAST")?.some((file) => file.startsWith("packages/ai"))).toBe(true);
    expect(
      read.get("META_WEBHOOK_VERIFY_TOKEN")?.some((file) => file.startsWith("packages/connectors")),
    ).toBe(true);
  });

  it("has one spelling per variable", () => {
    const names = entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const legacy of LEGACY_ALIASES) expect(names).not.toContain(legacy);
  });

  it("says in English who reads each variable", () => {
    for (const entry of entries) {
      expect(entry.comment, entry.name).toMatch(/^Read by (web|worker|edge|connectors)\b/);
    }
  });

  it("contains no real value", () => {
    for (const entry of entries) {
      if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|RECIPIENT/.test(entry.name)) {
        expect(entry.value, entry.name).toBe("");
      }
      // No project address, no credential-looking string: only local or numeric defaults.
      expect(entry.value, entry.name).toMatch(/^(|\d+|http:\/\/localhost:\d+)$/);
    }
  });
});
