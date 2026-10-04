import { PlainPage } from "@/components/shell/plain-page";
import { firstParam } from "@/lib/pagination";
import { safeNextPath } from "@/lib/routes";
import type { Metadata } from "next";
import { Confirm } from "./confirm";

export const metadata: Metadata = { title: "Conferma dell'accesso" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath(firstParam((await searchParams).next));
  return (
    <PlainPage title="Accesso in corso">
      <Confirm next={next} />
    </PlainPage>
  );
}
