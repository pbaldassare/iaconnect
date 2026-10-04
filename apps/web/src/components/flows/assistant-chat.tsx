"use client";
/**
 * AssistantChat — "Crea con l'assistente" and "Modifica con l'assistente".
 *
 *   <AssistantChat flowId={null} ask={askAssistant} save={saveProposal} />
 *
 * The customer describes the flow; each turn calls the `ask` server action
 * (quota check, AI call, usage log) and shows the assistant's note, its
 * questions and the proposed flow as a readable diagram. "Salva come bozza"
 * stores the proposal as a new version; nothing is activated from here.
 */
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/form-message";
import { Input, Textarea } from "@/components/ui/input";
import type { DiagramView } from "@/lib/flows/view";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FlowDiagram } from "./flow-diagram";

interface Proposal {
  definitionJson: string | null;
  diagram: DiagramView | null;
  questions: string[];
  note: string;
  leftoverIssues: string[];
  credits: number;
}
type AskReply = { ok: true; proposal: Proposal } | { ok: false; message: string };
type SaveReply = { ok: true; flowId: string; versionId: string } | { ok: false; message: string };
interface Turn {
  role: "user" | "assistant";
  content: string;
  questions?: string[];
}

export function AssistantChat({
  flowId,
  flowName,
  ask,
  save,
  examples = [],
}: {
  flowId: string | null;
  /** Name of the flow being modified. */
  flowName?: string;
  ask: (request: {
    flowId: string | null;
    description: string;
    history: { role: "user" | "assistant"; content: string }[];
    currentJson?: string;
  }) => Promise<AskReply>;
  save: (request: {
    flowId: string | null;
    name: string;
    definitionJson: string;
    note: string;
  }) => Promise<SaveReply>;
  examples?: string[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** The latest proposal that carried a valid flow: the one "Salva" stores and the next turn refines. */
  const [draft, setDraft] = useState<{ json: string; diagram: DiagramView; note: string } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const [saving, startSaving] = useTransition();
  const [credits, setCredits] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a turn is added
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  function send(message: string) {
    const description = message.trim();
    if (!description || asking) return;
    setError(null);
    const history = turns.map((turn) => ({
      role: turn.role,
      content: turn.questions?.length
        ? `${turn.content}\nDomande: ${turn.questions.join(" ")}`
        : turn.content,
    }));
    setTurns((previous) => [...previous, { role: "user", content: description }]);
    setText("");
    startAsking(async () => {
      let reply: AskReply;
      try {
        reply = await ask({ flowId, description, history, currentJson: draft?.json });
      } catch {
        reply = {
          ok: false,
          message: "La richiesta non è arrivata al server. Controlla la connessione e riprova.",
        };
      }
      if (!reply.ok) {
        setError(reply.message);
        // Give the text back so it can be sent again.
        setTurns((previous) => previous.slice(0, -1));
        setText(description);
        return;
      }
      const next = reply.proposal;
      setProposal(next);
      setCredits((previous) => previous + next.credits);
      if (next.definitionJson && next.diagram) {
        setDraft({ json: next.definitionJson, diagram: next.diagram, note: next.note });
      }
      setTurns((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            next.note ||
            (next.definitionJson ? "Ecco la proposta." : "Mi serve qualche informazione in più."),
          questions: next.questions,
        },
      ]);
    });
  }

  function saveDraft() {
    if (!draft || saving) return;
    if (!flowId && name.trim().length < 2) {
      setSaveError("Dai un nome al flusso prima di salvarlo.");
      return;
    }
    setSaveError(null);
    startSaving(async () => {
      let reply: SaveReply;
      try {
        reply = await save({ flowId, name, definitionJson: draft.json, note: draft.note });
      } catch {
        reply = { ok: false, message: "Il salvataggio non è arrivato al server. Riprova." };
      }
      if (!reply.ok) {
        setSaveError(reply.message);
        return;
      }
      router.push(`/app/flussi/${reply.flowId}?scheda=controlli&versione=${reply.versionId}&esito=bozza`);
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
      <Card aria-label="Conversazione con l'assistente" className="grid gap-4">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Assistente <AiBadge />
            </span>
          }
          description={
            flowId
              ? `Descrivi cosa cambiare in «${flowName ?? "questo flusso"}».`
              : "Descrivi a parole tue cosa deve succedere, da quale evento e con quali messaggi."
          }
          className="mb-0"
        />
        {turns.length === 0 && examples.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-[13px] text-muted">Per cominciare, un esempio:</p>
            <ul className="grid gap-2">
              {examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => setText(example)}
                    className="w-full rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {turns.length > 0 ? (
          <ol className="grid gap-3" aria-live="polite">
            {turns.map((turn, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
                key={index}
                className={
                  turn.role === "user"
                    ? "ml-6 rounded-lg bg-surface-2 px-3 py-2 text-sm"
                    : "mr-6 rounded-lg border border-ai/40 bg-ai-soft px-3 py-2 text-sm"
                }
              >
                <p className="mb-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
                  {turn.role === "user" ? "Tu" : "Assistente"}
                </p>
                <p className="whitespace-pre-wrap break-words">{turn.content}</p>
                {turn.questions && turn.questions.length > 0 ? (
                  <ul className="mt-2 grid list-disc gap-1 pl-4">
                    {turn.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {asking ? (
              <li className="mr-6 rounded-lg border border-ai/40 bg-ai-soft px-3 py-2 text-sm text-muted">
                L'assistente sta preparando la proposta: può volerci fino a un minuto…
              </li>
            ) : null}
          </ol>
        ) : null}
        <div ref={endRef} />
        {error ? (
          <Notice tone="error" announce="alert">
            {error}
          </Notice>
        ) : null}
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(text);
          }}
        >
          <Field
            label={turns.length === 0 ? "Cosa vuoi automatizzare?" : "Rispondi o chiedi una modifica"}
            htmlFor="assistant-text"
          >
            <Textarea
              id="assistant-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Quando arriva una mail con una richiesta di preventivo, scrivi al cliente su WhatsApp e apri una trattativa…"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="submit" icon="spark" aria-disabled={asking || text.trim().length < 5}>
              {asking ? "Un momento…" : turns.length === 0 ? "Chiedi una proposta" : "Invia"}
            </Button>
            {credits > 0 ? (
              <p className="text-[13px] text-muted">Crediti IA usati in questa conversazione: {credits}</p>
            ) : null}
          </div>
        </form>
      </Card>

      <Card aria-label="Proposta dell'assistente" className="grid gap-4">
        <CardHeader
          title="Proposta"
          description="Leggila con calma: resta una bozza finché non la attivi dalla pagina del flusso."
          className="mb-0"
        />
        {!draft ? (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">
            Qui compare il flusso proposto, passo per passo. Se all'assistente manca qualcosa te lo chiede
            nella conversazione.
          </p>
        ) : (
          <>
            {proposal && !proposal.definitionJson ? (
              <Notice tone="neutral">
                L'ultima risposta non contiene un flusso nuovo: sotto vedi la proposta precedente.
              </Notice>
            ) : null}
            <FlowDiagram view={draft.diagram} />
            {draft.diagram.warnings > 0 ? (
              <p className="text-[13px] text-muted">
                Gli avvisi non impediscono di salvare la bozza: li ritrovi nella scheda «Controlli».
              </p>
            ) : null}
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted">Vedi il JSON</summary>
              <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[12px] leading-relaxed">
                {draft.json}
              </pre>
            </details>
            <div className="grid gap-3 border-t border-line pt-4">
              {flowId ? null : (
                <Field label="Nome del flusso" htmlFor="flow-name">
                  <Input
                    id="flow-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder="Preventivi via mail"
                  />
                </Field>
              )}
              {saveError ? (
                <Notice tone="error" announce="alert">
                  {saveError}
                </Notice>
              ) : null}
              <div>
                <Button
                  type="button"
                  onClick={saveDraft}
                  aria-disabled={saving || (!flowId && name.trim().length < 2)}
                >
                  {saving
                    ? "Salvataggio…"
                    : flowId
                      ? "Salva come nuova versione (bozza)"
                      : "Salva come bozza"}
                </Button>
              </div>
            </div>
          </>
        )}
        {proposal && !proposal.definitionJson && proposal.leftoverIssues.length > 0 ? (
          <Notice tone="warning" title="L'assistente non è arrivato a un flusso valido">
            <ul className="grid list-disc gap-1 pl-4">
              {proposal.leftoverIssues.slice(0, 6).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </Card>
    </div>
  );
}
