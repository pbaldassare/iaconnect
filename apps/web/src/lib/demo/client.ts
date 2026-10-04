/**
 * In-memory stand-in for the Supabase client, used by the public demo of the customer area.
 *
 * It emulates the part of the supabase-js query builder that the pages under `/app` use,
 * over plain arrays of rows (`lib/demo/fixtures.ts`). It never opens a connection: reads
 * are answered from the arrays, and EVERY write (insert, update, upsert, delete, write
 * RPCs) changes nothing and returns an error with the code `DEMO_READ_ONLY`, which
 * `errorMessage()` in `lib/action.ts` turns into the Italian read-only message.
 *
 * Pure: no `server-only`, no runtime import from `@/…`, so the tests load it directly.
 */
import type { Database } from "@ia-connect/core";

type Tables = Database["ia_connect"]["Tables"];
export type DemoTableName = keyof Tables;
/** Rows per table. A table that is missing reads as empty. */
export type DemoTables = { [T in DemoTableName]?: Tables[T]["Row"][] };

export const DEMO_READ_ONLY = "DEMO_READ_ONLY";
export const DEMO_READ_ONLY_MESSAGE =
  "Questa è una demo: le modifiche sono disattivate. Registrati per provarlo con i tuoi dati.";

export interface DemoError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export interface DemoResult {
  data: unknown;
  error: DemoError | null;
  count: number | null;
  status: number;
  statusText: string;
}

/** The error every write gets. Also thrown (as a real Error) by the guards of the real client factories. */
export function demoReadOnlyError(): DemoError {
  return { code: DEMO_READ_ONLY, message: DEMO_READ_ONLY_MESSAGE, details: null, hint: null };
}

export class DemoReadOnlyError extends Error {
  readonly code = DEMO_READ_ONLY;
  constructor() {
    super(DEMO_READ_ONLY_MESSAGE);
    this.name = "DemoReadOnlyError";
  }
}

export function isDemoReadOnly(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === DEMO_READ_ONLY;
}

type AnyRow = Record<string, unknown>;
type Predicate = (row: AnyRow) => boolean;

// ── Comparisons (Postgres semantics: NULL never matches a comparison) ──────

function same(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && (typeof b === "number" || (typeof b === "string" && b.trim() !== ""))) {
    const n = Number(b);
    if (!Number.isNaN(n)) return a - n;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** SQL LIKE pattern (`%`, `_`, backslash escapes) → RegExp. PostgREST also accepts `*` for `%`. */
function likeToRegExp(pattern: string, insensitive: boolean): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "\\" && i + 1 < pattern.length) {
      out += escapeRegExp(pattern[++i]!);
    } else if (char === "%" || char === "*") out += "[\\s\\S]*";
    else if (char === "_") out += "[\\s\\S]";
    else out += escapeRegExp(char);
  }
  return new RegExp(`^${out}$`, insensitive ? "i" : "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `@>`: arrays contain every element; objects contain every key (recursively). */
function containsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((e) => actual.some((a) => containsValue(a, e)));
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    const record = actual as AnyRow;
    return Object.entries(expected as AnyRow).every(([key, value]) => containsValue(record[key], value));
  }
  return same(actual, expected);
}

function overlapsValue(actual: unknown, expected: unknown): boolean {
  return (
    Array.isArray(actual) && Array.isArray(expected) && expected.some((e) => actual.some((a) => same(a, e)))
  );
}

function isValue(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === "null") return actual === null || actual === undefined;
  if (expected === true || expected === "true") return actual === true;
  if (expected === false || expected === "false") return actual === false;
  return false;
}

/** One PostgREST operator against a row value. `value` is what supabase-js was given, or the text inside `or()`. */
function test(operator: string, actual: unknown, value: unknown): boolean {
  switch (operator) {
    case "eq":
      return same(actual, value);
    case "neq":
      return actual !== null && actual !== undefined && !same(actual, value);
    case "gt":
      return actual !== null && actual !== undefined && compare(actual, value) > 0;
    case "gte":
      return actual !== null && actual !== undefined && compare(actual, value) >= 0;
    case "lt":
      return actual !== null && actual !== undefined && compare(actual, value) < 0;
    case "lte":
      return actual !== null && actual !== undefined && compare(actual, value) <= 0;
    case "like":
      return typeof actual === "string" && likeToRegExp(String(value), false).test(actual);
    case "ilike":
      return typeof actual === "string" && likeToRegExp(String(value), true).test(actual);
    case "is":
      return isValue(actual, value);
    case "in":
      return Array.isArray(value) && value.some((v) => same(actual, v));
    case "cs":
      return containsValue(actual, value);
    case "ov":
      return overlapsValue(actual, value);
    default:
      throw new Error(`demo client: operator "${operator}" is not supported`);
  }
}

// ── or(): `a.eq.1,b.ilike."%x%",c.cs.{x},and(d.is.null,e.gt.3)` ───────────

/** Splits on top-level commas: not inside quotes, parentheses or braces. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      current += char;
      if (char === "\\" && i + 1 < input.length) current += input[++i]!;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "(" || char === "{") depth++;
    else if (char === ")" || char === "}") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current !== "") parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** `"a \"b\""` → `a "b"`; unquoted text is returned as it is. */
function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return trimmed;
}

/** Value written in a filter string → the value `test()` expects for the operator. */
function parseFilterValue(operator: string, raw: string): unknown {
  if (operator === "in") {
    const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
    return splitTopLevel(inner).map(unquote);
  }
  if (operator === "cs" || operator === "ov") {
    const text = raw.trim();
    if (text.startsWith("{") && !text.startsWith('{"') && !/^\{\s*\}$/.test(text) && !text.includes(":")) {
      return splitTopLevel(text.slice(1, -1)).map(unquote);
    }
    try {
      return JSON.parse(text);
    } catch {
      return splitTopLevel(text.replace(/^\{/, "").replace(/\}$/, "")).map(unquote);
    }
  }
  return unquote(raw);
}

/** One condition of an `or()` list → predicate. */
function parseCondition(condition: string): Predicate {
  const group = /^(and|or)\(([\s\S]*)\)$/.exec(condition);
  if (group) {
    const parts = splitTopLevel(group[2]!).map(parseCondition);
    return group[1] === "and" ? (row) => parts.every((p) => p(row)) : (row) => parts.some((p) => p(row));
  }
  const match = /^([A-Za-z_][\w]*)\.(not\.)?([a-z]+)\.([\s\S]*)$/.exec(condition);
  if (!match) throw new Error(`demo client: cannot read the filter "${condition}"`);
  const [, column, negated, operator, raw] = match;
  const value = parseFilterValue(operator!, raw!);
  const predicate: Predicate = (row) => test(operator!, row[column!], value);
  return negated ? (row) => !predicate(row) : predicate;
}

export function parseOrFilter(filter: string): Predicate {
  const parts = splitTopLevel(filter).map(parseCondition);
  return (row) => parts.some((p) => p(row));
}

// ── Column selection ───────────────────────────────────────────────────────

/** `"id, name, alias:column"` → picker. `*` (alone or in the list) keeps the whole row. */
function columnPicker(columns: string | undefined): (row: AnyRow) => AnyRow {
  const list = (columns ?? "*")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  if (list.length === 0 || list.includes("*")) return (row) => ({ ...row });
  const pairs = list.map((item) => {
    const [alias, source] = item.includes(":") ? item.split(":").map((s) => s.trim()) : [item, item];
    return [alias!, source!.replace(/::\w+$/, "")] as const;
  });
  return (row) => {
    const out: AnyRow = {};
    for (const [alias, source] of pairs) out[alias] = row[source] === undefined ? null : row[source];
    return out;
  };
}

// ── Query builder ──────────────────────────────────────────────────────────

interface SelectOptions {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
}

interface OrderOptions {
  ascending?: boolean;
  nullsFirst?: boolean;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class DemoQuery implements PromiseLike<DemoResult> {
  private readonly predicates: Predicate[] = [];
  private readonly orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private columns: string | undefined = "*";
  private wantCount = false;
  private head = false;
  private first: number | null = null;
  private max: number | null = null;
  private cardinality: "many" | "single" | "maybe" = "many";
  private write = false;

  constructor(private readonly rows: readonly AnyRow[]) {}

  select(columns?: string, options: SelectOptions = {}): this {
    this.columns = columns;
    if (options.count) this.wantCount = true;
    if (options.head) this.head = true;
    return this;
  }

  // Writes: nothing is stored; the builder keeps chaining so `.eq().select().single()` still works.
  insert(_values?: unknown, _options?: unknown): this {
    this.write = true;
    return this;
  }
  update(_values?: unknown, _options?: unknown): this {
    this.write = true;
    return this;
  }
  upsert(_values?: unknown, _options?: unknown): this {
    this.write = true;
    return this;
  }
  delete(_options?: unknown): this {
    this.write = true;
    return this;
  }

  private where(predicate: Predicate): this {
    this.predicates.push(predicate);
    return this;
  }
  eq(column: string, value: unknown): this {
    return this.where((row) => test("eq", row[column], value));
  }
  neq(column: string, value: unknown): this {
    return this.where((row) => test("neq", row[column], value));
  }
  gt(column: string, value: unknown): this {
    return this.where((row) => test("gt", row[column], value));
  }
  gte(column: string, value: unknown): this {
    return this.where((row) => test("gte", row[column], value));
  }
  lt(column: string, value: unknown): this {
    return this.where((row) => test("lt", row[column], value));
  }
  lte(column: string, value: unknown): this {
    return this.where((row) => test("lte", row[column], value));
  }
  like(column: string, pattern: string): this {
    return this.where((row) => test("like", row[column], pattern));
  }
  ilike(column: string, pattern: string): this {
    return this.where((row) => test("ilike", row[column], pattern));
  }
  is(column: string, value: boolean | null): this {
    return this.where((row) => test("is", row[column], value));
  }
  in(column: string, values: readonly unknown[]): this {
    return this.where((row) => test("in", row[column], values));
  }
  contains(column: string, value: unknown): this {
    return this.where((row) => test("cs", row[column], value));
  }
  overlaps(column: string, value: unknown): this {
    return this.where((row) => test("ov", row[column], value));
  }
  match(query: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(query)) this.eq(column, value);
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    const parsed = typeof value === "string" && operator !== "is" ? parseFilterValue(operator, value) : value;
    return this.where((row) => !test(operator, row[column], parsed));
  }
  filter(column: string, operator: string, value: unknown): this {
    const parsed = typeof value === "string" ? parseFilterValue(operator, value) : value;
    return this.where((row) => test(operator, row[column], parsed));
  }
  or(filters: string): this {
    return this.where(parseOrFilter(filters));
  }

  order(column: string, options: OrderOptions = {}): this {
    const ascending = options.ascending ?? true;
    // Postgres default: NULLS LAST when ascending, NULLS FIRST when descending.
    this.orders.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending });
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  range(from: number, to: number): this {
    this.first = from;
    this.max = to - from + 1;
    return this;
  }
  single(): this {
    this.cardinality = "single";
    return this;
  }
  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }
  returns(): this {
    return this;
  }
  abortSignal(): this {
    return this;
  }

  private run(): DemoResult {
    if (this.write) {
      return { data: null, error: demoReadOnlyError(), count: null, status: 403, statusText: "Forbidden" };
    }
    let rows = this.rows.filter((row) => this.predicates.every((p) => p(row)));
    const count = this.wantCount ? rows.length : null;
    if (this.orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending, nullsFirst } of this.orders) {
          const x = a[column] ?? null;
          const y = b[column] ?? null;
          if (x === null && y === null) continue;
          if (x === null) return nullsFirst ? -1 : 1;
          if (y === null) return nullsFirst ? 1 : -1;
          const order = compare(x, y);
          if (order !== 0) return ascending ? order : -order;
        }
        return 0;
      });
    }
    const start = this.first ?? 0;
    if (this.wantCount && this.first !== null && start > 0 && start >= rows.length) {
      // PostgREST answers 416 for an offset past the end.
      if (this.cardinality === "many" && !this.head) {
        return {
          data: null,
          error: { code: "PGRST103", message: "Requested range not satisfiable", details: null, hint: null },
          count,
          status: 416,
          statusText: "Range Not Satisfiable",
        };
      }
    }
    if (this.first !== null || this.max !== null) {
      rows = rows.slice(start, this.max === null ? undefined : start + this.max);
    }
    if (this.head) return { data: null, error: null, count, status: 200, statusText: "OK" };

    const pick = columnPicker(this.columns);
    const picked = rows.map((row) => clone(pick(row)));
    if (this.cardinality === "many") {
      return { data: picked, error: null, count, status: 200, statusText: "OK" };
    }
    if (picked.length === 1) return { data: picked[0], error: null, count, status: 200, statusText: "OK" };
    if (picked.length === 0 && this.cardinality === "maybe") {
      return { data: null, error: null, count, status: 200, statusText: "OK" };
    }
    return {
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: `The result contains ${picked.length} rows`,
        hint: null,
      },
      count,
      status: 406,
      statusText: "Not Acceptable",
    };
  }

  // biome-ignore lint/suspicious/noThenProperty: the supabase-js builder is awaited directly, so this one must be thenable too.
  then<A = DemoResult, B = never>(
    onfulfilled?: ((value: DemoResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    let result: Promise<DemoResult>;
    try {
      result = Promise.resolve(this.run());
    } catch (error) {
      result = Promise.reject(error);
    }
    return result.then(onfulfilled, onrejected);
  }
}

/** Answers for the read-only database functions. Anything not listed here is refused as a write. */
export type DemoRpcHandlers = Record<string, (args: Record<string, unknown>) => unknown>;

class DemoRpc implements PromiseLike<DemoResult> {
  constructor(private readonly result: DemoResult) {}
  single(): this {
    return this;
  }
  maybeSingle(): this {
    return this;
  }
  select(): this {
    return this;
  }
  // biome-ignore lint/suspicious/noThenProperty: awaited like the supabase-js builder.
  then<A = DemoResult, B = never>(
    onfulfilled?: ((value: DemoResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export interface DemoClient {
  /** Marks the object: `isDemoClient()` lets shared helpers skip the service client. */
  readonly __demo: true;
  from(table: string): DemoQuery;
  rpc(name: string, args?: Record<string, unknown>): DemoRpc;
  schema(name: string): DemoClient;
}

/**
 * The demo client over `tables`. `rpc` holds the answers of the read-only functions
 * (`quota_left`, `export_contact`…); every other function is treated as a write.
 */
export function createDemoClient(tables: DemoTables, rpc: DemoRpcHandlers = {}): DemoClient {
  const data = tables as Record<string, readonly AnyRow[] | undefined>;
  const client: DemoClient = {
    __demo: true,
    from: (table) => new DemoQuery(data[table] ?? []),
    rpc: (name, args = {}) => {
      const handler = Object.hasOwn(rpc, name) ? rpc[name] : undefined;
      if (!handler) {
        return new DemoRpc({
          data: null,
          error: demoReadOnlyError(),
          count: null,
          status: 403,
          statusText: "Forbidden",
        });
      }
      return new DemoRpc({
        data: clone(handler(args)) ?? null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
      });
    },
    schema: () => client,
  };
  return client;
}

export function isDemoClient(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { __demo?: unknown }).__demo === true;
}
