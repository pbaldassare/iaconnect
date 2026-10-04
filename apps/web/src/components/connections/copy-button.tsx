"use client";
/**
 * CopyButton, CopyBlock — copy a value to the clipboard.
 *
 *   <CopyBlock label="Indirizzo del webhook" value={url} />
 *   <CopyBlock label="Segreto di firma" value={secret} multiline={false} />
 *
 * The value stays selectable on the page, so it can be copied by hand where
 * the clipboard API is not available.
 */
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function CopyButton({ value, label = "Copia" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2500);
      }}
    >
      <span aria-live="polite">
        {state === "copied" ? "Copiato" : state === "failed" ? "Seleziona e copia a mano" : label}
      </span>
    </Button>
  );
}

export function CopyBlock({
  label,
  value,
  hint,
  pre = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Keep line breaks (example requests). */
  pre?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <CopyButton value={value} />
      </div>
      {pre ? (
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed">
          {value}
        </pre>
      ) : (
        <p className="break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[13px]">
          {value}
        </p>
      )}
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
