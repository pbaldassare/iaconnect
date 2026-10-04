import type { Metadata } from "next";
import { InboxView } from "../inbox-view";

export const metadata: Metadata = { title: "Conversazione" };

/** The thread as its own address: on narrow screens it is shown alone, on wide ones next to the list. */
export default async function InboxThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return <InboxView params={await searchParams} selectedId={id} />;
}
