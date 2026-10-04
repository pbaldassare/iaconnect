import { ContactForm } from "@/components/contacts/contact-form";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { createContact } from "../actions";

export const metadata: Metadata = { title: "Nuovo contatto" };

export default async function NewContactPage() {
  await requireOrg();
  return (
    <>
      <PageHeader title="Nuovo contatto" back={{ href: "/app/contatti", label: "Contatti" }} />
      <Card>
        <Notice tone="neutral" className="mb-5">
          Un contatto nuovo non ha consensi: prima di scrivergli registra il consenso del canale nella sua
          scheda, indicando da dove viene.
        </Notice>
        <ContactForm action={createContact} cancelHref="/app/contatti" submitLabel="Crea contatto" />
      </Card>
    </>
  );
}
