import { cn } from "@/lib/cn";
/**
 * Form controls: Input, Textarea, Select, Checkbox, Switch.
 *
 *   import { Input, Textarea, Select, Checkbox, Switch } from "@/components/ui/input";
 *   <Field label="Nome" htmlFor="name"><Input id="name" name="name" required /></Field>
 *   <Select id="plan" name="plan_id" defaultValue={x}><option value="…">Pro</option></Select>
 *   <Checkbox name="plans" value="pro" label="Pro" defaultChecked />
 *   <Switch name="enabled" label="Attivo" defaultChecked />      (a checkbox with role="switch")
 *
 * Always wrap Input/Textarea/Select in <Field> (components/ui/field) so they get a
 * label. Give the control an `id` equal to the Field's `htmlFor`: the control then
 * points to the Field's hint and error (`<id>-hint`, `<id>-error`) by itself.
 * Checkbox and Switch carry their own label.
 */
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CONTROL =
  "rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/85 " +
  "aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

/** Full width unless the caller sets a width (class names are joined, not merged). */
function control(className: string | undefined, ...parts: (string | false)[]) {
  return cn(CONTROL, !/(^|\s)w-/.test(className ?? "") && "w-full", ...parts, className);
}

function describedBy(id: string | undefined, explicit: string | undefined) {
  if (explicit) return explicit;
  return id ? `${id}-hint ${id}-error` : undefined;
}

const DENSE = "h-8 text-[13px] max-md:h-10";

export function Input({
  className,
  id,
  dense,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  /** 32px high (40px on phones), for rows of an editable list. */
  dense?: boolean;
}) {
  return (
    <input
      id={id}
      className={control(className, dense ? DENSE : "h-10")}
      {...rest}
      aria-describedby={describedBy(id, rest["aria-describedby"])}
    />
  );
}

export function Textarea({ className, id, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      id={id}
      rows={rows}
      className={control(className, "py-2 leading-relaxed")}
      {...rest}
      aria-describedby={describedBy(id, rest["aria-describedby"])}
    />
  );
}

export function Select({
  className,
  id,
  children,
  dense,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** 32px high (40px on phones), next to a `size="sm"` button. */
  dense?: boolean;
}) {
  return (
    <select
      id={id}
      className={control(className, dense ? DENSE : "h-10", "pr-9")}
      {...rest}
      aria-describedby={describedBy(id, rest["aria-describedby"])}
    >
      {children}
    </select>
  );
}

interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
}

export function Checkbox({ label, description, className, ...rest }: ToggleProps) {
  return (
    <label className={cn("flex min-h-8 cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" {...rest} />
      <span>
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Switch({ label, description, className, ...rest }: ToggleProps) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-sm", className)}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox exposes its checked state */}
        <input type="checkbox" role="switch" className="peer sr-only" {...rest} />
        <span
          aria-hidden
          className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-55"
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-0.5 size-4 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span>
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
