import { StatusPill } from "@/components/ui/badge";
import { type Consents, consentRows } from "@/lib/contacts/consents";
import { channelLabel } from "@/lib/customer-labels";
import { formatDate } from "@/lib/format";

/** Consent per channel, read-only: state, date and source. Used in the inbox side panel. */
export function ConsentSummary({ consents }: { consents: Consents }) {
  return (
    <ul className="grid gap-2">
      {consentRows(consents).map((row) => (
        <li key={row.channel} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{channelLabel(row.channel)}</span>
            <StatusPill
              tone={row.state === "granted" ? "ok" : row.state === "revoked" ? "error" : "neutral"}
              label={
                row.state === "granted"
                  ? "Consenso dato"
                  : row.state === "revoked"
                    ? "Revocato"
                    : "Non registrato"
              }
            />
          </div>
          {row.at ? (
            <p className="text-[13px] text-muted">
              {formatDate(row.at)}
              {row.source ? ` · ${row.source}` : ""}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
