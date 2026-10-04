"use client";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { THEME_CHOICES, THEME_COOKIE, type ThemeChoice, preferenceCookie } from "@/lib/theme";
import { useId, useState } from "react";

const ICONS: Record<ThemeChoice, IconName> = { light: "sun", dark: "moon", auto: "monitor" };

/**
 * Theme choice: Chiaro, Scuro, Automatico (follows the device). The choice goes in a cookie
 * read by the root layout, which sets `<html data-theme>`: no flash on the next page.
 * `initial` comes from the same cookie (see <ThemeSwitch> for a ready-made server wrapper).
 * Inside the shell sidebar the three segments become one cycling button while it is a rail.
 */
export function ThemeControl({ initial, className }: { initial: ThemeChoice; className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const name = useId();

  function pick(next: ThemeChoice) {
    setChoice(next);
    const root = document.documentElement;
    if (next === "auto") delete root.dataset.theme;
    else root.dataset.theme = next;
    document.cookie = preferenceCookie(THEME_COOKIE, next === "auto" ? null : next);
  }

  const index = THEME_CHOICES.findIndex((option) => option.value === choice);
  const current = THEME_CHOICES[index] ?? THEME_CHOICES[2];
  const following = THEME_CHOICES[(index + 1) % THEME_CHOICES.length] ?? THEME_CHOICES[0];

  return (
    <>
      <fieldset
        className={cn(
          "grid grid-cols-3 rounded-lg border border-line bg-surface-2 p-0.5 rail:hidden",
          className,
        )}
      >
        <legend className="sr-only">Tema</legend>
        {THEME_CHOICES.map((option) => (
          <label
            key={option.value}
            className="relative cursor-pointer"
            title={`Tema ${option.label.toLowerCase()}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={choice === option.value}
              onChange={() => pick(option.value)}
              className="peer sr-only"
            />
            <span className="flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[12.5px] font-semibold text-muted peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-[0_0_0_1px_var(--line-strong)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent max-md:h-10">
              <Icon name={ICONS[option.value]} className="size-3.5" />
              {option.value === "auto" ? (
                <>
                  <span aria-hidden>Auto</span>
                  <span className="sr-only">Automatico</span>
                </>
              ) : (
                option.label
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        onClick={() => following && pick(following.value)}
        title={`Tema: ${current?.label}. Passa a ${following?.label}`}
        aria-label={`Tema: ${current?.label}. Passa a ${following?.label}`}
        className="hidden size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink rail:flex"
      >
        <Icon name={ICONS[choice]} />
      </button>
    </>
  );
}
