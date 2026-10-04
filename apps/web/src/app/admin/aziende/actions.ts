"use server";
import { type ActionResult, fail, failFromError, parseForm } from "@/lib/action";
import { inviteToOrganization } from "@/lib/invitations";
import { requireStaff } from "@/lib/session";
import { SECTORS } from "@ia-connect/core";
import { redirect } from "next/navigation";
import { z } from "zod";

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Scrivi il nome dell'azienda.").max(120, "Il nome è troppo lungo."),
  sector: z.enum(SECTORS, "Scegli un settore."),
  plan_id: z.uuid("Scegli un piano."),
  reseller_id: z.uuid("Scegli un rivenditore."),
  owner_email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.email("Scrivi un indirizzo mail valido.")])),
});

export async function createOrganization(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, session } = await requireStaff();
  const parsed = parseForm(CreateSchema, formData);
  if (!parsed.ok) return parsed.result;
  const input = parsed.data;
  if (!session.isPlatformAdmin && !session.resellerIds.includes(input.reseller_id)) {
    return fail("Non puoi creare aziende per questo rivenditore.", {
      reseller_id: "Rivenditore non ammesso.",
    });
  }

  const { data: organization, error } = await supabase
    .from("organizations")
    .insert({
      name: input.name,
      sector: input.sector,
      plan_id: input.plan_id,
      reseller_id: input.reseller_id,
    })
    .select("id")
    .single();
  if (error) return failFromError(error);

  let outcome = "";
  if (input.owner_email) {
    const invite = await inviteToOrganization(supabase, {
      organizationId: organization.id,
      email: input.owner_email,
      role: "org_owner",
      invitedBy: session.user.id,
      actorType: "admin",
    });
    outcome = invite.ok ? invite.mail : "error";
  }
  const query = new URLSearchParams({ scheda: "utenti", creata: "1" });
  if (outcome) query.set("invito", outcome);
  redirect(`/admin/aziende/${organization.id}?${query.toString()}`);
}
