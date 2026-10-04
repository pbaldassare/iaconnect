"use client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/form-message";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { sectorLabel } from "@/lib/labels";
import {
  HONEYPOT_FIELD,
  PASSWORD_MIN,
  REQUEST_LIMITS,
  REQUEST_SECTORS,
  STARTED_AT_FIELD,
} from "@/lib/registration";
import Link from "next/link";
import { useActionState } from "react";
import { register, resendConfirmation } from "./actions";
import { REGISTER_IDLE, type ResendState } from "./state";

/** The public registration form and, after it, the «Controlla la posta» panel. */
export function RegisterForm({ startedAt }: { startedAt: number }) {
  const [state, action, pending] = useActionState(register, REGISTER_IDLE);

  if (state.step === "sent") return <CheckYourMail email={state.email} />;

  const errors = state.fieldErrors ?? {};
  const values = state.values;
  return (
    <form action={action} className="grid gap-4">
      {state.message ? (
        <Notice tone="error" announce="alert">
          {state.message}
        </Notice>
      ) : null}
      <input type="hidden" name={STARTED_AT_FIELD} value={startedAt} />
      {/* Honeypot: hidden from people and assistive technology, filled only by scripts. */}
      <div aria-hidden className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor="reference-code">Codice di riferimento (lascia vuoto)</label>
        <input id="reference-code" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Field label="Nome e cognome" htmlFor="full_name" error={errors.full_name}>
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          maxLength={REQUEST_LIMITS.fullName}
          defaultValue={values?.full_name}
          aria-invalid={errors.full_name ? true : undefined}
        />
      </Field>
      <Field label="Azienda" htmlFor="company_name" error={errors.company_name}>
        <Input
          id="company_name"
          name="company_name"
          autoComplete="organization"
          required
          maxLength={REQUEST_LIMITS.companyName}
          defaultValue={values?.company_name}
          aria-invalid={errors.company_name ? true : undefined}
        />
      </Field>
      <Field label="Settore" htmlFor="sector" error={errors.sector}>
        <Select id="sector" name="sector" defaultValue={values?.sector || "other"}>
          {REQUEST_SECTORS.map((sector) => (
            <option key={sector} value={sector}>
              {sectorLabel(sector)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Telefono" htmlFor="phone" optional error={errors.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={REQUEST_LIMITS.phone}
          defaultValue={values?.phone}
          aria-invalid={errors.phone ? true : undefined}
        />
      </Field>
      <Field label="Mail" htmlFor="email" error={errors.email} hint="Ti mandiamo un link per confermarla.">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={values?.email}
          aria-invalid={errors.email ? true : undefined}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={errors.password}
        hint={`Almeno ${PASSWORD_MIN} caratteri. Meglio una frase lunga che una parola con simboli.`}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={72}
          aria-invalid={errors.password ? true : undefined}
        />
      </Field>
      <Field
        label="Nota"
        htmlFor="message"
        optional
        error={errors.message}
        hint="Cosa vorresti automatizzare, o come ci hai conosciuto."
      >
        <Textarea
          id="message"
          name="message"
          rows={3}
          maxLength={REQUEST_LIMITS.message}
          defaultValue={values?.message}
        />
      </Field>

      <div className="grid gap-1.5">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="privacy"
            required
            className="mt-0.5 size-4 shrink-0 accent-accent"
            aria-describedby={errors.privacy ? "privacy-error" : undefined}
          />
          <span>
            Ho letto l'
            <Link href="/privacy" target="_blank" className="font-semibold underline">
              informativa sulla privacy
            </Link>
            .
          </span>
        </label>
        {errors.privacy ? (
          <p id="privacy-error" role="alert" className="text-[13px] font-medium text-danger">
            {errors.privacy}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        aria-disabled={pending}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {pending ? "Un momento…" : "Crea l'account"}
      </Button>
    </form>
  );
}

function CheckYourMail({ email }: { email: string }) {
  const [result, action, pending] = useActionState<ResendState, FormData>(resendConfirmation, null);
  return (
    <div className="grid gap-4" aria-live="polite">
      <div>
        <h2 className="font-display text-lg font-bold leading-tight tracking-tight">Controlla la posta</h2>
        <p className="mt-2 text-sm">
          Se <span className="break-all font-mono text-[13px]">{email}</span> non era già registrato, tra poco
          riceve una mail con il link per confermare l'indirizzo. Aprilo da questo stesso browser: la tua
          richiesta di accesso parte in quel momento.
        </p>
        <p className="mt-2 text-[13px] text-muted">
          Non arriva? Guarda nello spam. Se avevi già un account con questo indirizzo non arriva nessuna mail:
          entra da «Accedi» oppure reimposta la password.
        </p>
      </div>
      {result ? (
        <Notice tone={result.ok ? "ok" : "error"} announce={result.ok ? "status" : "alert"}>
          {result.message}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="email" value={email} />
          <Button
            type="submit"
            variant="secondary"
            icon="mail"
            aria-disabled={pending}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            {pending ? "Un momento…" : "Rinvia la mail"}
          </Button>
        </form>
        <ButtonLink href="/accedi" variant="ghost">
          Vai all'accesso
        </ButtonLink>
      </div>
    </div>
  );
}
