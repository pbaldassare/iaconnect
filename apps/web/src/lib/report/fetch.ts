/**
 * PostgREST returns at most 1000 rows per request: this reads a query page by
 * page up to a cap and says whether the cap cut the result. Pure (the query is injected).
 */
export const PAGE_ROWS = 1000;

export interface Paged<T> {
  rows: T[];
  /** True when there were more rows than the cap: figures built on `rows` are partial. */
  truncated: boolean;
  error: unknown;
}

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 10_000,
  pageSize = PAGE_ROWS,
): Promise<Paged<T>> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await page(from, to);
    if (error) return { rows, truncated: false, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < to - from + 1) return { rows, truncated: false, error: null };
  }
  // The cap was filled exactly: one more row tells whether anything was left out.
  const { data } = await page(maxRows, maxRows);
  return { rows, truncated: (data ?? []).length > 0, error: null };
}

/** Splits ids into chunks small enough for an `in (...)` filter in the URL. */
export function chunk<T>(items: readonly T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
