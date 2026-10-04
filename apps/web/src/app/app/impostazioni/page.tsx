import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Impostazioni" };

export default async function SettingsPage() {
  const { org } = await requireOrg();
  return (
    <>
      <PageHeader
        title="Impostazioni"
        description={
          org.canManage
            ? "Utenti, modelli di messaggio, assistente IA, marchio e trattative della tua azienda."
            : "Le impostazioni della tua azienda. Le modifiche sono riservate ai titolari."
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="flex h-full items-start justify-between gap-3 rounded-panel border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2/50"
            >
              <span>
                <span className="block font-display text-[16px] font-bold tracking-tight">
                  {section.label}
                </span>
                <span className="mt-1 block text-sm text-muted">{section.description}</span>
              </span>
              <Icon name="chevron-right" className="mt-1 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
