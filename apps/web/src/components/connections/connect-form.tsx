"use client";
/**
 * ConnectForm — the guided connection form, generated from a connector's input
 * schema (lib/connections/form-fields.ts), and the one-time result that follows:
 * webhook address, generated secrets, QR code.
 *
 *   <ConnectForm action={connectWithForm.bind(null, key, null)} fields={fields} defaultName="Gmail" />
 *
 * Secret fields are password inputs; their values go to the server action only
 * and never come back.
 */
import { ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import type { FormField } from "@/lib/connections/form-fields";
import { useActionState } from "react";
import { CopyBlock } from "./copy-button";

/** Mirrors ConnectState in app/app/collegamenti/state.ts (kept structural to avoid importing from a route folder). */
type State =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | {
      status: "done";
      connectionId: string;
      name: string;
      message: string;
      webhookUrl: string | null;
      secrets: { label: string; hint: string; value: string }[];
      example: string | null;
      qr: string | null;
      qrMessage: string | null;
      warnings: string[];
    };

const IDLE: State = { status: "idle" };

function Control({ field, value }: { field: FormField; value: string | undefined }) {
  const id = `f-${field.name}`;
  const initial = value ?? field.defaultValue;
  switch (field.kind) {
    case "password":
      return <Input id={id} name={field.name} type="password" autoComplete="off" required={field.required} />;
    case "number":
      return (
        <Input
          id={id}
          name={field.name}
          type="text"
          inputMode="decimal"
          defaultValue={initial}
          required={field.required}
        />
      );
    case "select":
      return (
        <Select id={id} name={field.name} defaultValue={initial ?? ""} required={field.required}>
          {field.required ? null : <option value="">—</option>}
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "list":
      return <Input id={id} name={field.name} defaultValue={initial} required={field.required} />;
    case "json":
      return (
        <Textarea
          id={id}
          name={field.name}
          rows={8}
          defaultValue={initial}
          required={field.required}
          className="font-mono text-[13px]"
          spellCheck={false}
        />
      );
    default:
      return (
        <Input
          id={id}
          name={field.name}
          type={field.kind === "url" ? "url" : field.kind === "email" ? "email" : "text"}
          defaultValue={initial}
          required={field.required}
          autoComplete="off"
        />
      );
  }
}

const HINTS: Partial<Record<FormField["kind"], string>> = {
  list: "Più valori separati da virgola.",
  json: "In formato JSON.",
  password: "Viene conservato cifrato e non sarà più mostrato.",
};

function Qr({ value }: { value: string }) {
  if (value.startsWith("data:image/")) {
    return (
      <img
        src={value}
        alt="Codice QR da inquadrare con WhatsApp"
        className="size-56 rounded-lg border border-line bg-white p-2"
      />
    );
  }
  return (
    <CopyBlock
      label="Codice di abbinamento"
      value={value}
      hint="Il fornitore non ha inviato un'immagine: usa questo codice in un generatore di QR, oppure apri il pannello del gateway."
    />
  );
}

function Done({ state }: { state: Extract<State, { status: "done" }> }) {
  const once = state.secrets.length > 0;
  return (
    <div className="grid gap-5">
      <Notice tone="ok" title={state.message} announce="status">
        {state.name}
      </Notice>
      {state.warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}
      {state.qr ? (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Inquadra il codice</p>
          {state.qrMessage ? <p className="text-sm text-muted">{state.qrMessage}</p> : null}
          <Qr value={state.qr} />
          <p className="text-[13px] text-muted">
            Dopo averlo inquadrato apri il collegamento e premi «Controlla stato».
          </p>
        </div>
      ) : state.qrMessage ? (
        <Notice tone="neutral">{state.qrMessage}</Notice>
      ) : null}
      {state.webhookUrl ? (
        <CopyBlock
          label="Indirizzo del webhook"
          value={state.webhookUrl}
          hint="È l'indirizzo che l'altro sistema deve chiamare. Lo ritrovi sempre nella pagina del collegamento."
        />
      ) : null}
      {once ? (
        <div className="grid gap-4">
          <Notice tone="warning" title="Copia adesso questi valori">
            Per sicurezza non saranno più visibili dopo aver lasciato questa pagina. Se li perdi dovrai
            ricollegare.
          </Notice>
          {state.secrets.map((secret) => (
            <CopyBlock key={secret.label} label={secret.label} value={secret.value} hint={secret.hint} />
          ))}
        </div>
      ) : null}
      {state.example ? (
        <CopyBlock
          label="Esempio di richiesta"
          value={state.example}
          pre
          hint="Sostituisci IL_TUO_SEGRETO con il segreto di firma. La firma è l'HMAC-SHA256 del corpo, in esadecimale."
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/app/collegamenti/${state.connectionId}`}>
          {once ? "Ho copiato, apri il collegamento" : "Apri il collegamento"}
        </ButtonLink>
        <ButtonLink href="/app/collegamenti" variant="secondary">
          Torna ai collegamenti
        </ButtonLink>
      </div>
    </div>
  );
}

export function ConnectForm({
  action,
  fields,
  defaultName,
  submitLabel = "Collega",
  showName = true,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  fields: FormField[];
  defaultName: string;
  submitLabel?: string;
  /** Hide the name field when reconnecting an existing connection. */
  showName?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  if (state.status === "done") return <Done state={state} />;
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};

  return (
    <form action={formAction} className="grid gap-4">
      {showName ? (
        <Field
          label="Nome del collegamento"
          htmlFor="f-connection_name"
          hint="Serve a te per riconoscerlo, ad esempio «Mail preventivi»."
          optional
        >
          <Input
            id="f-connection_name"
            name="connection_name"
            defaultValue={values.connection_name ?? defaultName}
            maxLength={120}
          />
        </Field>
      ) : null}
      {fields.map((field) =>
        field.kind === "boolean" ? (
          <Checkbox
            key={field.name}
            name={field.name}
            label={field.label}
            defaultChecked={
              values[field.name] !== undefined ? values[field.name] === "on" : field.defaultValue === "true"
            }
          />
        ) : (
          <Field
            key={field.name}
            label={field.label}
            htmlFor={`f-${field.name}`}
            hint={HINTS[field.kind]}
            error={errors[field.name]}
            optional={!field.required}
          >
            <Control field={field} value={values[field.name]} />
          </Field>
        ),
      )}
      {state.status === "error" ? (
        <Notice tone="error" announce="alert">
          {state.message}
        </Notice>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Collegamento in corso…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
