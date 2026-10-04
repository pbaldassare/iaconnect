"use client";
/**
 * AutoRefresh, RefreshButton — re-read the server data of the current page.
 *
 *   <AutoRefresh active={jobPending} />      refreshes every few seconds while `active`, for a few minutes
 *   <RefreshButton />                        "Aggiorna" by hand
 *
 * Used where the worker finishes a job in the background (simulations, traces, checks).
 */
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export function AutoRefresh({
  active,
  intervalMs = 4000,
  maxMinutes = 3,
}: {
  active: boolean;
  intervalMs?: number;
  maxMinutes?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > maxMinutes * 60_000) {
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, maxMinutes, router]);
  return active ? (
    <output className="block text-[13px] text-muted">In lavorazione: la pagina si aggiorna da sola.</output>
  ) : null;
}

export function RefreshButton({ label = "Aggiorna", size = "sm" }: { label?: string; size?: "md" | "sm" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      aria-disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Aggiorno…" : label}
    </Button>
  );
}
