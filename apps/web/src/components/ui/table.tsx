import { cn } from "@/lib/cn";
/**
 * Table — data table inside a horizontal scroll container (works at 380px).
 *
 *   import { Table, Th, Td } from "@/components/ui/table";
 *   <Table caption="Aziende" minWidth={640}>
 *     <thead><tr><Th>Nome</Th><Th align="right">Consumo</Th></tr></thead>
 *     <tbody>{rows.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td align="right" mono>{r.n}</Td></tr>)}</tbody>
 *   </Table>
 *
 * - `caption` is required and read by screen readers only.
 * - `minWidth` (px) is the width under which the table scrolls instead of squeezing.
 * - Td `mono` for ids, numbers and timestamps (never wraps); `muted` for secondary text.
 * - The first column (what the row is) never gets narrower than 160px.
 * - For an empty list render <EmptyState> instead of an empty table.
 * - The wrapper has `contain: inline-size`, so a wide table never stretches the grid or flex
 *   parent it sits in: the page does not scroll sideways, only the table does.
 */
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({
  caption,
  children,
  minWidth = 560,
  className,
  bare = false,
}: {
  caption: string;
  children: ReactNode;
  minWidth?: number;
  className?: string;
  /** No outer border/background: for tables placed inside a Card with padded={false}. */
  bare?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-x-auto contain-inline-size",
        !bare && "rounded-panel border border-line bg-surface",
        className,
      )}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
      tabIndex={0}
      aria-label={caption}
    >
      <table
        className="w-full border-collapse text-left text-sm [&_tbody_td:first-child]:min-w-40 [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-surface-2/50"
        style={{ minWidth }}
      >
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </section>
  );
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({
  children,
  align = "left",
  className,
  ...rest
}: { align?: Align } & Omit<ThHTMLAttributes<HTMLTableCellElement>, "align">) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line bg-surface-2/60 px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-muted first:pl-4 last:pr-4",
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono,
  muted,
  className,
  ...rest
}: { align?: Align; mono?: boolean; muted?: boolean } & Omit<
  TdHTMLAttributes<HTMLTableCellElement>,
  "align"
>) {
  return (
    <td
      className={cn(
        "border-b border-line px-3 py-2.5 align-top first:pl-4 last:pr-4",
        ALIGN[align],
        mono && "whitespace-nowrap font-mono text-[13px] tabular-nums",
        muted && "text-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
