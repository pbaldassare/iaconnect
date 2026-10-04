import { THEME_COOKIE, themeChoice } from "@/lib/theme";
import { cookies } from "next/headers";
import { ThemeControl } from "./theme-control";

/** Server wrapper: reads the stored choice and renders the theme control already in that state. */
export async function ThemeSwitch({ className }: { className?: string }) {
  return (
    <ThemeControl initial={themeChoice((await cookies()).get(THEME_COOKIE)?.value)} className={className} />
  );
}
