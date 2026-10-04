"use client";
import { cn } from "@/lib/cn";
/**
 * Field — label + control + hint + error for one form control.
 *
 *   import { Field } from "@/components/ui/field";
 *   <Field label="Mail del titolare" htmlFor="email" name="email" hint="Riceverà l'invito.">
 *     <Input id="email" name="email" type="email" required />
 *   </Field>
 *
 * - `htmlFor` must equal the control's `id`.
 * - `name` (optional) picks the field error from the enclosing <ActionForm> result;
 *   pass `error` to set it by hand.
 * - `optional` adds "(facoltativo)" to the label; required is the default assumption.
 */
import type { ReactNode } from "react";
import { useActionResult } from "./form";

export function Field({
  label,
  htmlFor,
  name,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  name?: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const result = useActionResult();
  const fieldError = error ?? (name && !result.ok ? result.fieldErrors?.[name] : undefined);
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
        {optional ? <span className="font-normal text-muted"> (facoltativo)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {fieldError ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {fieldError}
        </p>
      ) : null}
    </div>
  );
}
