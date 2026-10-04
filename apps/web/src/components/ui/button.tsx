import { cn } from "@/lib/cn";
/**
 * Button — the only way to render an action.
 *
 *   import { Button, ButtonLink } from "@/components/ui/button";
 *   <Button>Salva</Button>                               primary, submits the enclosing form
 *   <Button variant="secondary" type="button">Annulla</Button>
 *   <Button variant="danger" size="sm">Elimina</Button>
 *   <ButtonLink href="/app/flussi" variant="secondary" icon="plus">Nuovo flusso</ButtonLink>
 *
 * Variants: primary (one per view), secondary, ghost, danger. Sizes: md (40px), sm (32px).
 * Inside an <ActionForm> prefer <SubmitButton> (components/ui/form), which shows the pending state.
 */
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-on-danger hover:bg-danger-strong",
};
const SIZES: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-8 px-3 text-[13px]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children: ReactNode;
}

export function Button({
  variant,
  size,
  icon,
  className,
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...rest
}: CommonProps & Omit<ComponentProps<typeof Link>, "children">) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </Link>
  );
}
