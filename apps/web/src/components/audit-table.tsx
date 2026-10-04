import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Table, Td, Th } from "@/components/ui/table";
import {
  actorTypeLabel,
  auditFieldLabel,
  changedFields,
  describeAuditAction,
  isSupportRow,
} from "@/lib/audit-labels";
import { formatDateTime, shortId } from "@/lib/format";
import type { Row } from "@ia-connect/core";

/**
 * Rows of `audit_log`, used by the admin Registro and by the customer's
 * Impostazioni → Registro. Support accesses are marked with a badge and a
 * tinted row, never by color alone.
 */
export function AuditTable({
  rows,
  organizationNames,
  currentUserId,
}: {
  rows: Row<"audit_log">[];
  /** When given, an "Azienda" column is shown (admin view). */
  organizationNames?: Map<string, string>;
  currentUserId?: string;
}) {
  return (
    <Table caption="Registro delle azioni" minWidth={organizationNames ? 860 : 700}>
      <thead>
        <tr>
          <Th>Quando</Th>
          {organizationNames ? <Th>Azienda</Th> : null}
          <Th>Chi</Th>
          <Th>Cosa</Th>
          <Th>Dettagli</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const support = isSupportRow(row);
          const changed = changedFields(row.data);
          return (
            <tr key={row.id} className={support ? "bg-warn-soft/50" : undefined}>
              <Td mono className="whitespace-nowrap">
                {formatDateTime(row.created_at)}
              </Td>
              {organizationNames ? (
                <Td>
                  {row.organization_id
                    ? (organizationNames.get(row.organization_id) ?? (
                        <span className="font-mono text-[13px] text-muted">
                          {shortId(row.organization_id)}
                        </span>
                      ))
                    : "—"}
                </Td>
              ) : null}
              <Td>
                {row.actor_id && row.actor_id === currentUserId ? (
                  "Tu"
                ) : (
                  <>
                    <span className="block">{actorTypeLabel(row.actor_type)}</span>
                    {row.actor_id ? (
                      <span className="text-[13px] text-muted" title={row.actor_id}>
                        codice <span className="font-mono text-[12px]">{shortId(row.actor_id)}</span>
                      </span>
                    ) : null}
                  </>
                )}
              </Td>
              <Td>
                <span className="block font-medium">{describeAuditAction(row.action)}</span>
                {support ? (
                  <Badge tone="warning" className="mt-1">
                    <Icon name="shield" className="size-3" />
                    Assistenza
                  </Badge>
                ) : null}
              </Td>
              <Td muted className="text-[13px]">
                {changed.length > 0 ? (
                  <>
                    {changed.length === 1 ? "Modificato: " : "Modificati: "}
                    <span className="text-ink">{changed.map(auditFieldLabel).join(", ")}</span>
                  </>
                ) : row.entity_id ? (
                  <span title={row.entity_id}>
                    Codice <span className="font-mono text-[12px]">{shortId(row.entity_id)}</span>
                  </span>
                ) : (
                  "—"
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
