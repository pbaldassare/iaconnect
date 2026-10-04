"use client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormMessage, Notice } from "@/components/ui/form-message";
import { Input, Select, Textarea } from "@/components/ui/input";
import { type ActionResult, IDLE } from "@/lib/action";
import { placeholderIndexes, renderTemplate, variableCount } from "@/lib/message-templates";
import { useActionState, useEffect, useRef, useState } from "react";

export interface ComposerTemplate {
  id: string;
  name: string;
  body: string;
  subject: string | null;
}

/**
 * Composer of the inbox thread. On WhatsApp with the 24-hour window closed only an
 * approved template can be sent: the operator picks it and fills its values.
 */
export function Composer({
  action,
  channel,
  templateOnly,
  windowNote,
  windowOpen,
  templates,
  consentMissing,
  channelName,
  takesOver,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  channel: string;
  /** WhatsApp outside the 24 hours. */
  templateOnly: boolean;
  windowNote: string;
  windowOpen: boolean;
  /** WhatsApp: approved templates. Other channels: every template of the channel, used as a starting text. */
  templates: ComposerTemplate[];
  consentMissing: boolean;
  channelName: string;
  /** The conversation is with the automation: sending assigns it to the operator. */
  takesOver: boolean;
}) {
  const [result, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const isWhatsapp = channel === "whatsapp";
  const [mode, setMode] = useState<"free" | "template">(templateOnly ? "template" : "free");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const template = templates.find((item) => item.id === templateId) ?? null;
  const count = template ? variableCount(template.body) : 0;
  const effectiveMode = templateOnly ? "template" : mode;

  useEffect(() => {
    if (result.ok && result.message) {
      setContent("");
      setVariables([]);
      setTemplateId("");
    }
  }, [result]);

  const startFrom = (id: string) => {
    const chosen = templates.find((item) => item.id === id);
    if (!chosen) return;
    setContent(chosen.body);
    if (chosen.subject) setSubject(chosen.subject);
  };

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 border-t border-line p-3 sm:p-4">
      {consentMissing ? (
        <Notice tone="warning" title={`Manca il consenso per ${channelName}`}>
          Senza un consenso valido l'invio viene rifiutato. Registralo nella scheda del contatto prima di
          scrivere.
        </Notice>
      ) : null}
      {isWhatsapp ? (
        <Notice
          tone={windowOpen ? "neutral" : "warning"}
          title={windowOpen ? undefined : "Finestra di 24 ore chiusa"}
        >
          {windowNote}
        </Notice>
      ) : null}

      {isWhatsapp && !templateOnly && templates.length > 0 ? (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <legend className="sr-only">Tipo di messaggio</legend>
          <label className="flex min-h-8 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="free"
              checked={mode === "free"}
              onChange={() => setMode("free")}
              className="size-4 accent-accent"
            />
            Testo libero
          </label>
          <label className="flex min-h-8 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="template"
              checked={mode === "template"}
              onChange={() => setMode("template")}
              className="size-4 accent-accent"
            />
            Modello approvato
          </label>
        </fieldset>
      ) : (
        <input type="hidden" name="mode" value={effectiveMode} />
      )}

      {effectiveMode === "template" ? (
        templates.length === 0 ? (
          <Notice tone="neutral" title="Nessun modello approvato">
            Per scrivere fuori dalle 24 ore serve un modello WhatsApp approvato da Meta. Si creano in
            Impostazioni → Modelli di messaggio.
          </Notice>
        ) : (
          <>
            <Field label="Modello" htmlFor="composer-template" name="template_id">
              <Select
                id="composer-template"
                name="template_id"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setVariables([]);
                }}
                required
              >
                <option value="">Scegli un modello…</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            {template ? (
              <>
                {count > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Array.from({ length: count }, (_, index) => {
                      const used = placeholderIndexes(template.body).includes(index + 1);
                      const id = `composer-variable-${index + 1}`;
                      return (
                        <Field
                          // biome-ignore lint/suspicious/noArrayIndexKey: variables are positional
                          key={index}
                          label={`Valore {{${index + 1}}}`}
                          htmlFor={id}
                          hint={used ? undefined : "Non usato nel testo, ma richiesto dalla numerazione."}
                        >
                          <Input
                            id={id}
                            name="variables"
                            value={variables[index] ?? ""}
                            onChange={(event) => {
                              const next = [...variables];
                              next[index] = event.target.value;
                              setVariables(next);
                            }}
                            maxLength={500}
                            required
                          />
                        </Field>
                      );
                    })}
                  </div>
                ) : null}
                <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-sm">
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted">Anteprima</p>
                  <p className="whitespace-pre-wrap break-words">
                    {renderTemplate(template.body, variables)}
                  </p>
                </div>
              </>
            ) : null}
          </>
        )
      ) : (
        <>
          {!isWhatsapp && templates.length > 0 ? (
            <Field label="Parti da un modello" htmlFor="composer-start" optional>
              <Select id="composer-start" defaultValue="" onChange={(event) => startFrom(event.target.value)}>
                <option value="">Nessun modello</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {channel === "mail" ? (
            <Field label="Oggetto" htmlFor="composer-subject" name="subject" optional>
              <Input
                id="composer-subject"
                name="subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
              />
            </Field>
          ) : null}
          <Field label="Messaggio" htmlFor="composer-content" name="content">
            <Textarea
              id="composer-content"
              name="content"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={4000}
              required
              placeholder={`Scrivi su ${channelName}…`}
            />
          </Field>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {takesOver ? "Inviando prendi in carico la conversazione: l'automazione smette di rispondere." : ""}
        </p>
        <Button
          type="submit"
          aria-disabled={pending}
          disabled={effectiveMode === "template" && templates.length === 0}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          {pending ? "Un momento…" : "Invia"}
        </Button>
      </div>
      <FormMessage result={result} />
    </form>
  );
}
