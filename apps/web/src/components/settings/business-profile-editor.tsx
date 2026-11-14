"use client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { BusinessProfile } from "@/lib/settings/business-profile";
import { useState } from "react";

type HourRow = BusinessProfile["openingHours"][number] & { id: number };
type LocRow = BusinessProfile["locations"][number] & { id: number };

export function BusinessProfileEditor({
  initial,
  disabled,
}: {
  initial: BusinessProfile;
  disabled: boolean;
}) {
  const [hours, setHours] = useState<HourRow[]>(() =>
    (initial.openingHours.length ? initial.openingHours : [{ label: "Lun–Ven", hours: "" }]).map(
      (row, id) => ({ ...row, id }),
    ),
  );
  const [locations, setLocations] = useState<LocRow[]>(() =>
  (initial.locations.length ? initial.locations : [{ name: "", address: "" }]).map((row, id) => ({
      ...row,
      id,
    })),
  );
  const [services, setServices] = useState(() =>
    (initial.services.length ? initial.services : [""]).map((line, id) => ({ line, id })),
  );
  const [topics, setTopics] = useState(() =>
    (initial.whatsappTopics.length ? initial.whatsappTopics : [""]).map((line, id) => ({ line, id })),
  );
  const [nextId, setNextId] = useState(100);

  const bump = () => {
    const id = nextId;
    setNextId((n) => n + 1);
    return id;
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Presentazione</h2>
        <Textarea
          name="summary"
          rows={3}
          defaultValue={initial.summary ?? ""}
          placeholder="In due righe: chi siete, zona servita, cosa vi contraddistingue."
          maxLength={500}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Orari di apertura</h2>
        <ul className="grid gap-2">
          {hours.map((row, index) => (
            <li
              key={row.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center"
            >
              <Input
                name="hour_label"
                defaultValue={row.label}
                placeholder="Es. Lun–Ven"
                maxLength={80}
                disabled={disabled}
                aria-label={`Etichetta orari ${index + 1}`}
              />
              <Input
                name="hour_value"
                defaultValue={row.hours}
                placeholder="Es. 9:00–13:00, 15:00–19:00"
                maxLength={120}
                disabled={disabled}
                aria-label={`Fascia oraria ${index + 1}`}
              />
              {disabled ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setHours((rows) => rows.filter((item) => item.id !== row.id))}
                >
                  Togli
                </Button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setHours((r) => [...r, { label: "", hours: "", id: bump() }])}>
            Aggiungi fascia oraria
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Sedi e sportelli</h2>
        <ul className="grid gap-4">
          {locations.map((row, index) => (
            <li key={row.id} className="grid gap-2 rounded-lg border border-line p-3">
              <Input name="loc_name" defaultValue={row.name} placeholder="Nome sede" maxLength={80} disabled={disabled} aria-label={`Nome sede ${index + 1}`} />
              <Input name="loc_address" defaultValue={row.address} placeholder="Indirizzo completo" maxLength={200} disabled={disabled} aria-label={`Indirizzo ${index + 1}`} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input name="loc_phone" defaultValue={row.phone ?? ""} placeholder="Telefono (facoltativo)" maxLength={40} disabled={disabled} />
                <Input name="loc_hours" defaultValue={row.hours ?? ""} placeholder="Orari sportello (facoltativo)" maxLength={120} disabled={disabled} />
              </div>
              <Input name="loc_notes" defaultValue={row.notes ?? ""} placeholder="Note (parcheggio, accesso, ecc.)" maxLength={300} disabled={disabled} />
              {disabled ? null : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLocations((rows) => rows.filter((item) => item.id !== row.id))}>
                  Togli sede
                </Button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setLocations((r) => [...r, { name: "", address: "", id: bump() }])}>
            Aggiungi sede
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Servizi</h2>
        <ul className="grid gap-2">
          {services.map((row, index) => (
            <li key={row.id} className="flex gap-2">
              <Input
                name="service_line"
                defaultValue={row.line}
                placeholder="Es. RCA auto, polizze casa, rinnovi"
                maxLength={120}
                disabled={disabled}
                className="flex-1"
                aria-label={`Servizio ${index + 1}`}
              />
              {disabled ? null : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setServices((rows) => rows.filter((item) => item.id !== row.id))}>
                  Togli
                </Button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setServices((r) => [...r, { line: "", id: bump() }])}>
            Aggiungi servizio
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="font-display text-[15px] font-bold">Su WhatsApp può spiegare</h2>
        <p className="text-sm text-muted">Argomenti che l'IA può trattare in autonomia (orari, sedi, preventivi generici…).</p>
        <ul className="grid gap-2">
          {topics.map((row, index) => (
            <li key={row.id} className="flex gap-2">
              <Input name="wa_topic" defaultValue={row.line} placeholder="Es. Orari e come raggiungerci" maxLength={160} disabled={disabled} className="flex-1" aria-label={`Argomento ${index + 1}`} />
              {disabled ? null : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setTopics((rows) => rows.filter((item) => item.id !== row.id))}>
                  Togli
                </Button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setTopics((r) => [...r, { line: "", id: bump() }])}>
            Aggiungi argomento
          </Button>
        )}
      </div>
    </div>
  );
}