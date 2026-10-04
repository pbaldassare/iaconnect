"use client";
import { type ActionResult, IDLE } from "@/lib/action";
/**
 * ActionForm, SubmitButton — forms bound to a server action that returns an ActionResult.
 *
 *   import { ActionForm, SubmitButton } from "@/components/ui/form";
 *   <ActionForm action={saveSettings} className="grid gap-4">
 *     <Field label="Nome" htmlFor="name" name="name"><Input id="name" name="name" /></Field>
 *     <SubmitButton>Salva</SubmitButton>
 *   </ActionForm>
 *
 * - `action` has the signature `(prev: ActionResult, formData: FormData) => Promise<ActionResult>`
 *   (see lib/action.ts). The result message is shown above the children's end
 *   (success and error) and announced to screen readers.
 * - <Field name="…"> inside the form shows the matching `fieldErrors[name]`.
 * - Works without JavaScript (progressive enhancement of <form action>).
 * - `useActionResult()` gives nested client components the latest result.
 */
import { type ReactNode, createContext, useActionState, useContext } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { FormMessage } from "./form-message";
import type { IconName } from "./icons";

const ResultContext = createContext<ActionResult>(IDLE);

export function useActionResult(): ActionResult {
  return useContext(ResultContext);
}

export function ActionForm({
  action,
  children,
  className,
  messagePosition = "bottom",
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  /** Where the result message appears relative to the children. */
  messagePosition?: "top" | "bottom";
}) {
  const [result, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className={className} noValidate={false}>
      <ResultContext.Provider value={result}>
        {messagePosition === "top" ? <FormMessage result={result} /> : null}
        {children}
        {messagePosition === "bottom" ? <FormMessage result={result} /> : null}
      </ResultContext.Provider>
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Un momento…",
  variant,
  size,
  icon,
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      icon={icon}
      className={className}
      name={name}
      value={value}
      disabled={disabled}
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
