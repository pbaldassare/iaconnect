"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-10">
      <div className="rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight">
          Qualcosa non ha funzionato
        </h1>
        <p className="mt-2 text-muted">
          La pagina non si è caricata. Riprova; se succede ancora, scrivi all'assistenza indicando il codice
          qui sotto.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[13px] text-muted">Codice: {error.digest}</p>
        ) : null}
        <div className="mt-5">
          <Button type="button" onClick={reset}>
            Riprova
          </Button>
        </div>
      </div>
    </main>
  );
}
