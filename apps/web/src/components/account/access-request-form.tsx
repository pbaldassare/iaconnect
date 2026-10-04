import { saveAccessRequest } from "@/app/in-attesa/actions";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { sectorLabel } from "@/lib/labels";
import { REQUEST_LIMITS, REQUEST_SECTORS } from "@/lib/registration";

/**
 * The access request form: company, sector, phone, note. Used to ask for access the first
 * time (/completa-registrazione) and to correct or send again a request (/in-attesa).
 * `idPrefix` keeps the ids unique when the page has another form.
 */
export function AccessRequestForm({
  defaults,
  submitLabel,
  idPrefix = "request",
}: {
  defaults?: {
    fullName?: string | null;
    companyName?: string | null;
    sector?: string | null;
    phone?: string | null;
    message?: string | null;
  };
  submitLabel: string;
  idPrefix?: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <ActionForm action={saveAccessRequest} className="grid gap-4">
      <Field label="Nome e cognome" htmlFor={id("full_name")} name="full_name" optional>
        <Input
          id={id("full_name")}
          name="full_name"
          autoComplete="name"
          maxLength={REQUEST_LIMITS.fullName}
          defaultValue={defaults?.fullName ?? ""}
        />
      </Field>
      <Field label="Azienda" htmlFor={id("company_name")} name="company_name">
        <Input
          id={id("company_name")}
          name="company_name"
          autoComplete="organization"
          required
          maxLength={REQUEST_LIMITS.companyName}
          defaultValue={defaults?.companyName ?? ""}
        />
      </Field>
      <Field label="Settore" htmlFor={id("sector")} name="sector">
        <Select id={id("sector")} name="sector" defaultValue={defaults?.sector ?? "other"}>
          {REQUEST_SECTORS.map((sector) => (
            <option key={sector} value={sector}>
              {sectorLabel(sector)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Telefono" htmlFor={id("phone")} name="phone" optional>
        <Input
          id={id("phone")}
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={REQUEST_LIMITS.phone}
          defaultValue={defaults?.phone ?? ""}
        />
      </Field>
      <Field
        label="Nota"
        htmlFor={id("message")}
        name="message"
        optional
        hint="Cosa vorresti automatizzare, o come ci hai conosciuto."
      >
        <Textarea
          id={id("message")}
          name="message"
          rows={3}
          maxLength={REQUEST_LIMITS.message}
          defaultValue={defaults?.message ?? ""}
        />
      </Field>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
