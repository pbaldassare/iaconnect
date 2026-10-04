/** Pagination math and URL building for server-rendered lists. Pure, unit tested. */

/** Reads the `pagina` search param: an integer ≥ 1, anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

/** Zero-based inclusive row range for PostgREST `.range(from, to)`. */
export function pageWindow(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(page, 1) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Path + query string; empty, null and undefined values are dropped, and page 1 is implicit. */
export function withParams(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (key === "pagina" && Number(value) === 1) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** First value of a search param. */
export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Escapes `%`, `_` and `\` so user text is matched literally by `ilike`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
