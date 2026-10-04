/**
 * Display preferences kept in cookies, so the server renders the right state and nothing
 * flashes: the theme (`<html data-theme>`) and the width of the shell sidebar.
 * Pure functions; the cookies are written by the browser (they are not secrets).
 */
export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark";
/** What the person picks: a theme, or "auto" to follow the device (no cookie). */
export type ThemeChoice = Theme | "auto";

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Chiaro" },
  { value: "dark", label: "Scuro" },
  { value: "auto", label: "Automatico" },
];

/** Returns the stored override, or null to follow the system preference. */
export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function themeChoice(value: string | undefined | null): ThemeChoice {
  return parseTheme(value) ?? "auto";
}

export const SIDEBAR_COOKIE = "sidebar";
/** "auto" = no stored choice: icon rail between 768 and 1100px, expanded above. */
export type SidebarState = "expanded" | "collapsed" | "auto";

export function parseSidebar(value: string | undefined | null): SidebarState {
  return value === "expanded" || value === "collapsed" ? value : "auto";
}

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The `document.cookie` string that stores (or, with null, forgets) a preference. */
export function preferenceCookie(name: string, value: string | null): string {
  return `${name}=${value ?? ""}; path=/; max-age=${value === null ? 0 : ONE_YEAR}; samesite=lax`;
}
