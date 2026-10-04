"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

/**
 * Key/value editor for `contacts.custom_fields`. Submits parallel `field_key` /
 * `field_value` inputs; rows left empty are ignored by the action.
 */
export function CustomFieldsEditor({ initial }: { initial: { key: string; value: string }[] }) {
  const [rows, setRows] = useState(() => [
    ...initial.map((row, index) => ({ ...row, id: index })),
    { key: "", value: "", id: initial.length },
  ]);
  const [nextId, setNextId] = useState(initial.length + 1);
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Campi personalizzati</legend>
      <p className="text-[13px] text-muted">
        Dati liberi che i flussi possono leggere e confrontare, per esempio{" "}
        <code className="font-mono">zona</code> = Centro, <code className="font-mono">budget_max</code> =
        250000. I numeri vanno scritti senza simboli.
      </p>
      <ul className="grid gap-2">
        {rows.map((row, index) => (
          <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
            <Input
              name="field_key"
              defaultValue={row.key}
              aria-label={`Nome del campo ${index + 1}`}
              placeholder="nome (es. zona)"
              maxLength={40}
            />
            <Input
              name="field_value"
              defaultValue={row.value}
              aria-label={`Valore del campo ${index + 1}`}
              placeholder="valore"
              maxLength={500}
            />
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="px-2.5"
              onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              aria-label={`Togli il campo ${index + 1}`}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => {
            setRows((current) => [...current, { key: "", value: "", id: nextId }]);
            setNextId((id) => id + 1);
          }}
        >
          Aggiungi campo
        </Button>
      </div>
    </fieldset>
  );
}
