"use client";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { signIn } from "./actions";

export function SignInForm({ next }: { next: string }) {
  return (
    <ActionForm action={signIn} className="grid gap-4" messagePosition="top">
      <input type="hidden" name="next" value={next} />
      <Field label="Mail" htmlFor="email" name="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        name="password"
        hint={
          <Link href="/password-dimenticata" className="underline hover:text-ink">
            Password dimenticata?
          </Link>
        }
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" />
      </Field>
      <div className="grid gap-2">
        <SubmitButton name="intent" value="password">
          Accedi
        </SubmitButton>
        <SubmitButton name="intent" value="link" variant="secondary" icon="mail">
          Ricevi un link via mail
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
