"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormMessage, Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { type ActionResult, IDLE } from "@/lib/action";
import { useActionState, useState } from "react";
import { issueApiKey } from "./actions";

const ISSUED = /^iac_[0-9a-f]{64}$/;

export function IssueKeyForm({ organizations }: { organizations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(issueApiKey, IDLE);
  const issued = state.ok && state.message && ISSUED.test(state.message) ? state.message : null;
  const [copied, setCopied] = useState(false);
  const fieldErrors = state.ok ? undefined : state.fieldErrors;

  return (
    <form action={action} className="grid gap-4">
      <Field label="Nome" htmlFor="name" error={fieldErrors?.name}>
        <Input id="name" name="name" required maxLength={80} placeholder="Gestionale Pititto" />
      </Field>
      <Field
        label="Ambito"
        htmlFor="organization_id"
        error={fieldErrors?.organization_id}
        hint="Una chiave di un cliente non legge le altre aziende."
      >
        <Select id="organization_id" name="organization_id" defaultValue="">
          <option value="">Tutti i clienti</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? "Un momento…" : "Crea chiave"}
        </Button>
      </div>
      {issued ? (
        <Notice tone="ok" announce="status" title="Chiave creata">
          <p>Copiala ora. Non viene più mostrata: in archivio resta solo l'impronta.</p>
          <code className="mt-2 block break-all font-mono text-[13px]">{issued}</code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              void navigator.clipboard.writeText(issued).then(() => setCopied(true));
            }}
          >
            {copied ? "Copiata" : "Copia"}
          </Button>
        </Notice>
      ) : (
        <FormMessage result={state as ActionResult} />
      )}
    </form>
  );
}
