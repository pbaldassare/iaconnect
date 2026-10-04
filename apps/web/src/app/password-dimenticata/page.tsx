import { PlainPage } from "@/components/shell/plain-page";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "./actions";

export const metadata: Metadata = { title: "Password dimenticata" };

export default function ForgotPasswordPage() {
  return (
    <PlainPage
      title="Password dimenticata"
      intro="Scrivi la mail del tuo account: ti mandiamo un link per scegliere una nuova password."
    >
      <ActionForm action={requestPasswordReset} className="grid gap-4" messagePosition="top">
        <Field label="Mail" htmlFor="email" name="email">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </Field>
        <SubmitButton icon="mail">Invia il link</SubmitButton>
      </ActionForm>
      <p className="mt-5 border-t border-line pt-4 text-sm">
        <Link href="/accedi" className="font-semibold text-accent-strong underline">
          Torna all'accesso
        </Link>
      </p>
    </PlainPage>
  );
}
