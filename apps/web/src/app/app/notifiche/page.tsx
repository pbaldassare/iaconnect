import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { errorMessage } from "@/lib/action";
import { cn } from "@/lib/cn";
import { safeInternalLink } from "@/lib/customer-labels";
import { formatDateTime, formatRelative } from "@/lib/format";
import { pageWindow, parsePage, withParams } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export const metadata: Metadata = { title: "Notifiche" };

const PATH = "/app/notifiche";
const PAGE_SIZE = 30;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrg();
  const organizationId = org.organization.id;
  const page = parsePage((await searchParams).pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);
  const [list, unread, approvals] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, link, read_at, created_at", { count: "exact" })
      .eq("organization_id", organizationId)
      // Unread first (read_at is null), then the newest.
      .order("read_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("read_at", null),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
  ]);
  const notifications = list.data ?? [];
  const unreadCount = unread.count ?? 0;
  const pendingApprovals = approvals.count ?? 0;

  return (
    <>
      <PageHeader
        title="Notifiche"
        description="Gli avvisi dei flussi e della piattaforma: un cliente che chiede una persona, un collegamento da rinnovare, un invio non riuscito."
        actions={
          <>
            <ButtonLink href="/app/approvazioni" variant="secondary" icon="check">
              Approvazioni{pendingApprovals > 0 ? ` (${pendingApprovals})` : ""}
            </ButtonLink>
            {unreadCount > 0 ? (
              <form action={markAllNotificationsRead}>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
                >
                  Segna tutte come lette
                </button>
              </form>
            ) : null}
          </>
        }
      />
      {list.error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(list.error)}
        </Notice>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nessuna notifica"
          description="Qui arrivano gli avvisi che richiedono la tua attenzione. Quando tutto funziona, resta vuoto."
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {unreadCount === 0
              ? "Tutte lette."
              : unreadCount === 1
                ? "1 notifica da leggere."
                : `${unreadCount} notifiche da leggere.`}
          </p>
          <ul className="overflow-hidden rounded-panel border border-line bg-surface">
            {notifications.map((notification) => {
              const isUnread = notification.read_at === null;
              const link = safeInternalLink(notification.link);
              return (
                <li
                  key={notification.id}
                  className={cn(
                    "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line p-3 last:border-b-0 sm:p-4",
                    isUnread && "bg-accent-soft/40",
                  )}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {isUnread ? <Badge tone="ok">Da leggere</Badge> : null}
                      <span className={cn(isUnread ? "font-bold" : "font-semibold")}>
                        {notification.title}
                      </span>
                    </p>
                    {notification.body ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
                        {notification.body}
                      </p>
                    ) : null}
                    <p
                      className="mt-1 font-mono text-[12px] text-muted"
                      title={formatDateTime(notification.created_at)}
                    >
                      {formatRelative(notification.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {link ? (
                      <Link
                        href={link}
                        className="inline-flex h-8 max-md:h-10 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold hover:bg-surface-2"
                      >
                        Apri
                        <Icon name="chevron-right" className="size-4" />
                      </Link>
                    ) : null}
                    {isUnread ? (
                      <form action={markNotificationRead.bind(null, notification.id)}>
                        <button
                          type="submit"
                          className="inline-flex h-8 max-md:h-10 items-center rounded-lg px-3 text-[13px] font-semibold hover:bg-surface-2"
                        >
                          Segna come letta<span className="sr-only">: {notification.title}</span>
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.count ?? 0}
            hrefFor={(p) => withParams(PATH, { pagina: p })}
          />
        </>
      )}
    </>
  );
}
