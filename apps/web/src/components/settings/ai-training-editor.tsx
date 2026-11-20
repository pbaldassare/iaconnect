"use client";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { AiTraining } from "@/lib/settings/ai-training";
import { useState } from "react";

type Row = AiTraining["entries"][number] & { rowKey: number };

export function AiTrainingEditor({ initial, disabled }: { initial: AiTraining; disabled: boolean }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.entries.length
      ? initial.entries
      : [
          {
            id: crypto.randomUUID(),
            question: "A che ora aprite?",
            answer: "",
            active: true,
          },
        ]
    ).map((entry, rowKey) => ({ ...entry, rowKey })),
  );
  const [nextKey, setNextKey] = useState(rows.length);

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h2 className="font-display text-[15px] font-bold">Note per l&apos;IA</h2>
        <Textarea
          name="training_notes"
          rows={3}
          defaultValue={initial.notes ?? ""}
          placeholder="Regole extra, promozioni in corso, cosa non promettere mai."
          maxLength={1000}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Domande e risposte addestrate</h2>
        <p className="text-sm text-muted">
          Quando un contatto fa una domanda simile, l&apos;IA usa queste risposte come riferimento (insieme al
          profilo azienda).
        </p>
        <ul className="grid gap-4">
          {rows.map((row, index) => (
            <li key={row.rowKey} className="grid gap-2 rounded-lg border border-line p-3">
              <input type="hidden" name="train_id" value={row.id} />
              <Input
                name="train_topic"
                defaultValue={row.topic ?? ""}
                placeholder="Argomento (facoltativo, es. Orari)"
                maxLength={80}
                disabled={disabled}
                aria-label={`Argomento riga ${index + 1}`}
              />
              <Input
                name="train_question"
                defaultValue={row.question}
                placeholder="Domanda del cliente"
                maxLength={300}
                required
                disabled={disabled}
                aria-label={`Domanda ${index + 1}`}
              />
              <Textarea
                name="train_answer"
                rows={3}
                defaultValue={row.answer}
                placeholder="Risposta che l'IA deve dare"
                maxLength={1000}
                required
                disabled={disabled}
                aria-label={`Risposta ${index + 1}`}
              />
              <Select
                name="train_active"
                defaultValue={row.active ? "1" : "0"}
                disabled={disabled}
                aria-label={`Stato riga ${index + 1}`}
              >
                <option value="1">Attiva</option>
                <option value="0">Disattiva</option>
              </Select>
              {disabled ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((current) => current.filter((item) => item.rowKey !== row.rowKey))}
                >
                  Togli
                </Button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={() => {
              setRows((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  question: "",
                  answer: "",
                  topic: "",
                  active: true,
                  rowKey: nextKey,
                },
              ]);
              setNextKey((n) => n + 1);
            }}
          >
            Aggiungi domanda
          </Button>
        )}
      </div>
    </div>
  );
}
