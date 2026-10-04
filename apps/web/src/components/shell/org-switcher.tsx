"use client";
import { useRef } from "react";
import { switchOrganization } from "./actions";

/** Shown only when the user belongs to more than one organization. Submits on change. */
export function OrgSwitcher({
  organizations,
  currentId,
}: {
  organizations: { id: string; name: string }[];
  currentId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={switchOrganization}>
      <label
        htmlFor="org-switcher"
        className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted"
      >
        Azienda
      </label>
      <select
        id="org-switcher"
        name="org"
        defaultValue={currentId ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-10 w-full truncate rounded-lg border border-line-strong bg-surface pl-2.5 pr-9 text-sm font-semibold"
      >
        {currentId === null ? <option value="">Scegli…</option> : null}
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="mt-1 text-sm underline">
          Cambia azienda
        </button>
      </noscript>
    </form>
  );
}
