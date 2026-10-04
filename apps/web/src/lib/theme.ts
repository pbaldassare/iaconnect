/** Theme override stored in a cookie so the server can render `data-theme` without a flash. */
export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark";

/** Returns the stored override, or null to follow the system preference. */
export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}
