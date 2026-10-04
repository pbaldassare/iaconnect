"use client";
/**
 * PasswordInput — password field with a «Mostra / Nascondi» control.
 *
 *   import { PasswordInput } from "@/components/ui/password-input";
 *   <Field label="Password" htmlFor="password" name="password" hint="Almeno 10 caratteri.">
 *     <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} />
 *   </Field>
 *
 * Same props as <Input>. Without JavaScript it is a plain password field (the button does
 * nothing). The button is not a submit button and does not take the value out of the form.
 */
import { type InputHTMLAttributes, useState } from "react";
import { Input } from "./input";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-2">
      <Input {...props} type={visible ? "text" : "password"} className="min-w-0 flex-1" />
      <button
        type="button"
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((v) => !v)}
        className="h-10 shrink-0 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2"
      >
        {visible ? "Nascondi" : "Mostra"}
        <span className="sr-only"> la password</span>
      </button>
    </div>
  );
}
