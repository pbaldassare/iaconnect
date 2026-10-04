import { ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { customFieldRows } from "@/lib/contacts/fields";
import { CustomFieldsEditor } from "./custom-fields-editor";

/** Create and edit form of a contact. */
export function ContactForm({
  action,
  contact,
  cancelHref,
  submitLabel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  contact?: { full_name: string; phones: string[]; emails: string[]; custom_fields: unknown };
  cancelHref: string;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="grid max-w-2xl gap-5">
      <Field label="Nome e cognome" htmlFor="full_name" name="full_name">
        <Input
          id="full_name"
          name="full_name"
          defaultValue={contact?.full_name ?? ""}
          maxLength={120}
          required
        />
      </Field>
      <Field
        label="Telefoni"
        htmlFor="phones"
        name="phones"
        optional
        hint="Uno per riga. Senza prefisso si intende +39. Vengono salvati nel formato internazionale."
      >
        <Textarea id="phones" name="phones" rows={2} defaultValue={contact?.phones.join("\n") ?? ""} />
      </Field>
      <Field label="Mail" htmlFor="emails" name="emails" optional hint="Una per riga.">
        <Textarea id="emails" name="emails" rows={2} defaultValue={contact?.emails.join("\n") ?? ""} />
      </Field>
      <CustomFieldsEditor initial={customFieldRows(contact?.custom_fields)} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Annulla
        </ButtonLink>
      </div>
    </ActionForm>
  );
}
