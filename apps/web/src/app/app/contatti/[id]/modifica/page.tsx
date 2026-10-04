import { ContactForm } from "@/components/contacts/contact-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isUuid } from "@/lib/org-selection";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateContact } from "../../actions";

export const metadata: Metadata = { title: "Modifica contatto" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org } = await requireOrg();
  if (!isUuid(id)) notFound();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, phones, emails, custom_fields")
    .eq("id", id)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (!contact) notFound();
  return (
    <>
      <PageHeader
        title="Modifica contatto"
        back={{ href: `/app/contatti/${contact.id}`, label: contact.full_name.trim() || "Contatto" }}
      />
      <Card>
        <ContactForm
          action={updateContact.bind(null, contact.id)}
          contact={contact}
          cancelHref={`/app/contatti/${contact.id}`}
          submitLabel="Salva"
        />
      </Card>
    </>
  );
}
