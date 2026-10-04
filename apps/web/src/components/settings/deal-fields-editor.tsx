"use client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DEAL_FIELD_TYPES, DEAL_FIELD_TYPE_LABELS, type DealFieldDef } from "@/lib/deals/stages";
import { useState } from "react";

/** Rows of `org_settings.deal_custom_fields`: label, type and the key the flows use. */
export function DealFieldsEditor({ initial, disabled }: { initial: DealFieldDef[]; disabled: boolean }) {
  const [rows, setRows] = useState(() => initial.map((def, index) => ({ ...def, id: index, stored: true })));
  const [nextId, setNextId] = useState(initial.length);
  return (
    <div className="grid gap-3">
      {rows.length === 0 ? <p className="text-sm text-muted">Nessun campo definito.</p> : null}
      <ul className="grid gap-3">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_auto] sm:items-center sm:border-0 sm:p-0"
          >
            <Input
              name="def_label"
              defaultValue={row.label}
              aria-label={`Etichetta del campo ${index + 1}`}
              placeholder="Etichetta (es. Tipo di polizza)"
              maxLength={60}
              disabled={disabled}
            />
            <Input
              name="def_key"
              defaultValue={row.key}
              aria-label={`Codice del campo ${index + 1}`}
              placeholder="codice (facoltativo)"
              maxLength={40}
              className="font-mono text-[13px]"
              // A stored key is what flows and saved deals refer to: it is not renamed from here.
              readOnly={row.stored}
              disabled={disabled}
            />
            <Select
              name="def_type"
              defaultValue={row.type}
              aria-label={`Tipo del campo ${index + 1}`}
              disabled={disabled}
            >
              {DEAL_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DEAL_FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            {disabled ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              >
                Togli<span className="sr-only"> il campo {index + 1}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {disabled ? null : (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={() => {
              setRows((current) => [
                ...current,
                { key: "", label: "", type: "text", id: nextId, stored: false },
              ]);
              setNextId((id) => id + 1);
            }}
          >
            Aggiungi campo
          </Button>
        </div>
      )}
    </div>
  );
}
