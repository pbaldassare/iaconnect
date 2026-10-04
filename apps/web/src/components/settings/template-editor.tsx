"use client";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/form-message";
import { Input, Select, Textarea } from "@/components/ui/input";
import { TEMPLATE_APPROVAL_KEYS, templateApprovalStatus } from "@/lib/customer-labels";
import { missingPlaceholders, renderTemplate, sampleVariables, variableCount } from "@/lib/message-templates";
import { useState } from "react";

export interface TemplateValues {
  name: string;
  language: string;
  subject: string;
  body: string;
  external_name: string;
  approval_status: string;
}

/** Fields of a message template with a live preview filled with sample values. Lives inside an ActionForm. */
export function TemplateEditor({
  channel,
  initial,
  disabled,
  isNew,
}: {
  channel: string;
  initial: TemplateValues;
  disabled: boolean;
  isNew: boolean;
}) {
  const [body, setBody] = useState(initial.body);
  const [subject, setSubject] = useState(initial.subject);
  const isWhatsapp = channel === "whatsapp";
  const isMail = channel === "mail";
  const count = variableCount(body, isMail ? subject : "");
  const samples = sampleVariables(count);
  const missing = missingPlaceholders(isMail ? subject : "", body);

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_110px]">
          <Field
            label="Nome"
            htmlFor="name"
            name="name"
            hint={
              isWhatsapp && !isNew
                ? "I flussi richiamano il modello con questo nome: se lo cambi, aggiorna anche i flussi che lo usano."
                : "Serve a te e ai flussi per riconoscerlo."
            }
          >
            <Input
              id="name"
              name="name"
              defaultValue={initial.name}
              maxLength={80}
              required
              disabled={disabled}
            />
          </Field>
          <Field label="Lingua" htmlFor="language" name="language">
            <Input
              id="language"
              name="language"
              defaultValue={initial.language}
              maxLength={5}
              required
              disabled={disabled}
            />
          </Field>
        </div>
        {isMail ? (
          <Field label="Oggetto" htmlFor="subject" name="subject" optional>
            <Input
              id="subject"
              name="subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
              disabled={disabled}
            />
          </Field>
        ) : null}
        <Field
          label="Testo"
          htmlFor="body"
          name="body"
          hint="Dove va un dato che cambia ogni volta scrivi {{1}}, {{2}}, {{3}}… in ordine. Chi invia li riempie al momento."
        >
          <Textarea
            id="body"
            name="body"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            required
            disabled={disabled}
          />
        </Field>
        {missing.length > 0 ? (
          <Notice tone="warning">
            I valori vanno numerati di seguito: manca {missing.map((n) => `{{${n}}}`).join(", ")}.
          </Notice>
        ) : null}
        {isWhatsapp ? (
          <div className="grid gap-4 rounded-lg border border-line bg-surface-2/60 p-3 sm:p-4">
            <p className="text-sm">
              <span className="font-semibold">I modelli WhatsApp devono essere approvati da Meta.</span> Crea
              il modello con lo stesso testo nel tuo account WhatsApp Business; quando Meta lo approva, torna
              qui, scrivi il nome che ha su Meta e imposta lo stato su «Approvato». Solo i modelli approvati
              si possono inviare fuori dalle 24 ore.
            </p>
            <Field
              label="Nome su Meta"
              htmlFor="external_name"
              name="external_name"
              optional
              hint="Il nome del modello nel tuo account WhatsApp Business, es. promemoria_appuntamento. Se è vuoto si usa il nome qui sopra."
            >
              <Input
                id="external_name"
                name="external_name"
                defaultValue={initial.external_name}
                maxLength={120}
                className="font-mono text-[13px]"
                disabled={disabled}
              />
            </Field>
            <Field label="Stato dell'approvazione" htmlFor="approval_status" name="approval_status">
              <Select
                id="approval_status"
                name="approval_status"
                defaultValue={initial.approval_status}
                disabled={disabled}
              >
                {TEMPLATE_APPROVAL_KEYS.map((status) => (
                  <option key={status} value={status}>
                    {templateApprovalStatus(status).label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-line bg-surface-2/60 p-3 sm:p-4" aria-live="polite">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted">
          Anteprima con valori di esempio
        </p>
        {isMail && subject.trim() ? (
          <p className="mb-2 break-words text-sm font-semibold">{renderTemplate(subject, samples)}</p>
        ) : null}
        <p className="whitespace-pre-wrap break-words rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          {body.trim() ? (
            renderTemplate(body, samples)
          ) : (
            <span className="text-muted">Scrivi il testo per vedere l'anteprima.</span>
          )}
        </p>
        {count > 0 ? (
          <ul className="mt-3 grid gap-1 font-mono text-[12.5px] text-muted">
            {samples.map((sample, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional placeholders
              <li key={index}>
                {`{{${index + 1}}}`} = {sample}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-muted">
            Nessun valore da riempire: il testo parte sempre uguale.
          </p>
        )}
      </div>
    </div>
  );
}
