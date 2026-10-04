"use client";
import { Icon } from "@/components/ui/icons";
import { THEME_COOKIE } from "@/lib/theme";

/** Switches between light and dark and remembers the choice in a cookie (read by the root layout). */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon name="sun" />
      Tema chiaro / scuro
    </button>
  );
}
