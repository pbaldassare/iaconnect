/**
 * Pagination — previous/next links for server-rendered lists.
 *
 *   import { Pagination } from "@/components/ui/pagination";
 *   import { pageWindow, parsePage, withParams } from "@/lib/pagination";
 *   const page = parsePage(searchParams.pagina);
 *   const { from, to } = pageWindow(page, 25);
 *   const { data, count } = await supabase.from("x").select("*", { count: "exact" }).range(from, to);
 *   <Pagination page={page} pageSize={25} total={count ?? 0}
 *     hrefFor={(p) => withParams("/admin/aziende", { ...filters, pagina: p })} />
 *
 * Renders nothing when everything fits on one page.
 */
import { formatNumber } from "@/lib/format";
import { pageCount } from "@/lib/pagination";
import { ButtonLink } from "./button";

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagine" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[13px] text-muted">
        Pagina {page} di {pages} · {formatNumber(total)} in tutto
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <ButtonLink href={hrefFor(page - 1)} variant="secondary" size="sm" rel="prev">
            Precedente
          </ButtonLink>
        ) : null}
        {page < pages ? (
          <ButtonLink href={hrefFor(page + 1)} variant="secondary" size="sm" rel="next">
            Successiva
          </ButtonLink>
        ) : null}
      </div>
    </nav>
  );
}
