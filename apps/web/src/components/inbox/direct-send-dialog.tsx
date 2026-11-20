"use client";
import { sendDirectMessage } from "@/app/app/inbox/actions";
import type { ComposerTemplate } from "@/components/inbox/composer";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton, useActionResult } from "@/components/ui/form";
import { FormMessage, Notice } from "@/components/ui/form-message";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { placeholderIndexes, variableCount } from "@/lib/message-templates";
import { useState } from "react";

export function DirectSendDialog({ templates }: { templates: ComposerTemplate[] }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((item) => item.id === templateId) ?? null;
  const count = template ? variableCount(template.body) : 0;
  const [variables, setVariables] = useState<string[]>([]);

  return (
    <Dialog
      triggerLabel="Scrivi a un numero"
      triggerVariant="primary"
      triggerSize="sm"
      triggerIcon="inbox"
      title="Invia a un numero fuori rubrica"
      description="Crea il contatto se non esiste, apre la conversazione e mette in coda il messaggio. Su WhatsApp serve un modello approvato se non c'è stata una risposta nelle ultime 24 ore."
    >
      <DirectSendForm
        templates={templates}
        templateId={templateId}
        setTemplateId={setTemplateId}
        template={template}
        count={count}
        variables={variables}
        setVariables={setVariables}
      />
    </Dialog>
  );
}

function DirectSendForm({
  templates,
  templateId,
  setTemplateId,
  template,
  count,
  variables,
  setVariables,
}: {
  templates: ComposerTemplate[];
  templateId: string;
  setTemplateId: (id: string) => void;
  template: ComposerTemplate | null;
  count: number;
  variables: string[];
  setVariables: (values: string[]) => void;
}) {
  const result = useActionResult();
  return (
    <ActionForm action={sendDirectMessage} className="grid gap-4">
      <FormMessage result={result} />
      <input type="hidden" name="channel" value="whatsapp" />
      <input type="hidden" name="mode" value="template" />
      <Field
        label="Cellulare"
        htmlFor="direct-phone"
        name="phone"
        hint="Con prefisso internazionale, es. +39 333 1234567"
      >
        <Input
          id="direct-phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          placeholder="+39 333 1234567"
        />
      </Field>
      <Field label="Nome (facoltativo)" htmlFor="direct-name" name="full_name" optional>
        <Input id="direct-name" name="full_name" maxLength={120} placeholder="Es. Mario Rossi" />
      </Field>
      <Checkbox
        name="register_consent"
        value="1"
        defaultChecked
        label="Registra il consenso WhatsApp per questo numero (necessario per l'invio)."
      />
      {templates.length === 0 ? (
        <Notice tone="warning">
          Non ci sono modelli WhatsApp approvati. Creane uno in Impostazioni → Modelli di messaggio.
        </Notice>
      ) : (
        <>
          <Field label="Modello WhatsApp" htmlFor="direct-template" name="template_id">
            <Select
              id="direct-template"
              name="template_id"
              required
              value={templateId}
              onChange={(event) => {
                const id = event.target.value;
                setTemplateId(id);
                const chosen = templates.find((item) => item.id === id);
                setVariables(Array(variableCount(chosen?.body ?? "")).fill(""));
              }}
            >
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          {template ? (
            <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted whitespace-pre-wrap">
              {template.body}
            </p>
          ) : null}
          {count > 0 && template ? (
            <ul className="grid gap-2">
              {placeholderIndexes(template.body).map((index) => (
                <li key={index}>
                  <Field label={`Valore {{${index}}}`} htmlFor={`direct-var-${index}`} name="variables">
                    <Input
                      id={`direct-var-${index}`}
                      name="variables"
                      value={variables[index - 1] ?? ""}
                      onChange={(event) => {
                        const next = [...variables];
                        next[index - 1] = event.target.value;
                        setVariables(next);
                      }}
                      maxLength={500}
                      required
                    />
                  </Field>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <SubmitButton disabled={templates.length === 0}>Metti in coda</SubmitButton>
    </ActionForm>
  );
}
