import { AiBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrgManager } from "@/lib/session";
import type { Metadata } from "next";
import { createRecipe } from "../actions";
import { TRACE_LINE } from "../labels";

export const metadata: Metadata = { title: "Nuova lettura" };

export default async function NewRecipePage() {
  const { supabase, org } = await requireOrgManager();
  const { data: connections } = await supabase
    .from("connections")
    .select("id, name, status")
    .eq("organization_id", org.organization.id)
    .eq("connector_type", "scraper_site")
    .neq("status", "disconnected")
    .order("name");

  return (
    <>
      <PageHeader
        title="Nuova lettura da un sito"
        description="Indica la pagina e, a parole tue, cosa va letto."
        back={{ href: "/app/collegamenti/siti", label: "Siti e portali" }}
      />
      <div className="grid max-w-2xl gap-5">
        <Notice tone="ai" title={<AiBadge>Usa crediti IA una sola volta</AiBadge>}>
          {TRACE_LINE}
        </Notice>
        <Card>
          <ActionForm action={createRecipe} className="grid gap-4">
            <Field
              label="Nome"
              htmlFor="name"
              name="name"
              hint="Ad esempio «Annunci del portale immobiliare»."
            >
              <Input id="name" name="name" required maxLength={120} />
            </Field>
            <Field label="Indirizzo della pagina" htmlFor="target_url" name="target_url">
              <Input
                id="target_url"
                name="target_url"
                type="url"
                required
                placeholder="https://www.esempio.it/annunci"
              />
            </Field>
            <Field
              label="Cosa va letto"
              htmlFor="goal"
              name="goal"
              hint="Scrivi come lo spiegheresti a un collaboratore: quali righe e quali dati di ogni riga."
            >
              <Textarea
                id="goal"
                name="goal"
                required
                rows={4}
                placeholder="L'elenco degli annunci in vendita: titolo, prezzo, zona, metri quadri e indirizzo dell'annuncio."
              />
            </Field>
            <Field
              label="Accesso al sito"
              htmlFor="connection_id"
              name="connection_id"
              optional
              hint="Solo se per vedere la pagina bisogna entrare con nome utente e password: prima crea un collegamento «Sito o portale»."
            >
              <Select id="connection_id" name="connection_id" defaultValue="">
                <option value="">Nessun accesso: la pagina è pubblica</option>
                {(connections ?? []).map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Ogni quanti minuti"
              htmlFor="interval_minutes"
              name="interval_minutes"
              hint="Minimo 15. Ogni lettura conta nel limite mensile del piano."
            >
              <Input
                id="interval_minutes"
                name="interval_minutes"
                type="number"
                min={15}
                max={10080}
                step={1}
                defaultValue={60}
                required
                className="max-w-40"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingLabel="Creazione…">Crea e traccia il percorso</SubmitButton>
              <ButtonLink href="/app/collegamenti/siti" variant="ghost">
                Annulla
              </ButtonLink>
            </div>
          </ActionForm>
        </Card>
        {(connections ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            Il sito richiede l'accesso?{" "}
            <a href="/app/collegamenti/nuovo/scraper_site" className="underline">
              Crea prima il collegamento «Sito o portale»
            </a>
            .
          </p>
        ) : null}
      </div>
    </>
  );
}
