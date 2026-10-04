import { ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { DEAL_FIELD_TYPE_LABELS, type DealFieldDef } from "@/lib/deals/stages";
import { centsToEurosInput } from "@/lib/parse";
import type { ReactNode } from "react";

/** Shared fields of the deal create and edit forms. `children` come first (contact and stage on create). */
export function DealForm({
  action,
  deal,
  assignees,
  fieldDefs,
  submitLabel,
  cancelHref,
  children,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  deal?: {
    title: string;
    estimated_value_cents: number | null;
    next_action: string | null;
    next_action_at: string | null;
    assignee_user_id: string | null;
    custom_fields: unknown;
  };
  assignees: { id: string; label: string }[];
  fieldDefs: DealFieldDef[];
  submitLabel: string;
  cancelHref?: string;
  children?: ReactNode;
}) {
  const stored = (
    typeof deal?.custom_fields === "object" && deal.custom_fields !== null ? deal.custom_fields : {}
  ) as Record<string, unknown>;
  return (
    <ActionForm action={action} className="grid gap-4">
      {children}
      <Field label="Titolo" htmlFor="title" name="title">
        <Input id="title" name="title" defaultValue={deal?.title ?? ""} maxLength={160} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valore stimato (€)" htmlFor="value" name="value" optional>
          <Input
            id="value"
            name="value"
            inputMode="decimal"
            defaultValue={
              deal?.estimated_value_cents !== null && deal?.estimated_value_cents !== undefined
                ? centsToEurosInput(deal.estimated_value_cents)
                : ""
            }
            placeholder="Es. 1500"
          />
        </Field>
        <Field label="Assegnata a" htmlFor="assignee_user_id" name="assignee_user_id" optional>
          <Select id="assignee_user_id" name="assignee_user_id" defaultValue={deal?.assignee_user_id ?? ""}>
            <option value="">Nessuno</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prossima azione" htmlFor="next_action" name="next_action" optional>
          <Input
            id="next_action"
            name="next_action"
            defaultValue={deal?.next_action ?? ""}
            maxLength={300}
            placeholder="Es. Richiamare per la proposta"
          />
        </Field>
        <Field label="Entro il" htmlFor="next_action_at" name="next_action_at" optional>
          <Input
            id="next_action_at"
            name="next_action_at"
            type="date"
            defaultValue={deal?.next_action_at ? deal.next_action_at.slice(0, 10) : ""}
          />
        </Field>
      </div>
      {fieldDefs.length > 0 ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Campi della tua azienda</legend>
          {fieldDefs.map((def) => {
            const id = `cf_${def.key}`;
            const value = stored[def.key];
            return (
              <Field key={def.key} label={def.label} htmlFor={id} name={id} optional>
                {def.type === "boolean" ? (
                  <Select
                    id={id}
                    name={id}
                    defaultValue={value === true ? "true" : value === false ? "false" : ""}
                  >
                    <option value="">Non indicato</option>
                    <option value="true">Sì</option>
                    <option value="false">No</option>
                  </Select>
                ) : (
                  <Input
                    id={id}
                    name={id}
                    type={def.type === "date" ? "date" : "text"}
                    inputMode={def.type === "number" ? "decimal" : undefined}
                    defaultValue={
                      typeof value === "number"
                        ? String(value).replace(".", ",")
                        : typeof value === "string"
                          ? value
                          : ""
                    }
                    placeholder={def.type === "number" ? DEAL_FIELD_TYPE_LABELS.number : undefined}
                    maxLength={500}
                  />
                )}
              </Field>
            );
          })}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <ButtonLink href={cancelHref} variant="ghost">
            Annulla
          </ButtonLink>
        ) : null}
      </div>
    </ActionForm>
  );
}
