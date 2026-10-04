import { PlainPage } from "@/components/shell/plain-page";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { setPassword } from "./actions";

export const metadata: Metadata = { title: "Scegli la password" };

export default async function SetPasswordPage() {
  const session = await requireUser();
  return (
    <PlainPage
      title="Scegli la password"
      intro={
        <>
          Per <span className="font-mono text-[13px] text-ink">{session.user.email}</span>. La userai per
          entrare le prossime volte.
        </>
      }
    >
      <ActionForm action={setPassword} className="grid gap-4" messagePosition="top">
        <Field label="Nuova password" htmlFor="password" name="password" hint="Almeno 10 caratteri.">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
        </Field>
        <Field label="Ripeti la password" htmlFor="confirm" name="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <SubmitButton>Salva la password</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-sm">
        <Link href="/area-riservata" className="text-muted underline hover:text-ink">
          Non ora, continua
        </Link>
      </p>
    </PlainPage>
  );
}
