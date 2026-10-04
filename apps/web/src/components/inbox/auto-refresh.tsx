"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Reloads the server data of the current page every `seconds` while the tab is
 * visible (polling: the safe choice until Realtime is verified on the ia_connect schema).
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
