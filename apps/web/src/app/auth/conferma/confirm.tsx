"use client";
import { Notice } from "@/components/ui/form-message";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { finishSignIn } from "./actions";

/** Reads the session from the URL fragment (invitation links), stores it and continues. */
export function Confirm({ next }: { next: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const supabase = createClient();
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        if (error) {
          if (!cancelled) setFailed(true);
          return;
        }
        const invited = hash.get("type") === "invite" || hash.get("type") === "recovery";
        await finishSignIn(invited ? "/imposta-password" : next);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) await finishSignIn(next);
      else if (!cancelled) setFailed(true);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [next]);

  if (failed) {
    return (
      <div className="grid gap-4">
        <Notice tone="error" announce="alert">
          Il link non è più valido o è già stato usato.
        </Notice>
        <Link href="/accedi" className="font-semibold text-accent underline">
          Torna all'accesso e chiedi un nuovo link
        </Link>
      </div>
    );
  }
  return (
    <p aria-live="polite" className="text-muted">
      Un momento, ti stiamo facendo entrare…
    </p>
  );
}
