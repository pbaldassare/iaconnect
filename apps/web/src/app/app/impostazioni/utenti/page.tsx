import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { formatDate, shortId } from "@/lib/format";
import { invitationStatus, roleLabel } from "@/lib/labels";
import { requireOrg } from "@/lib/session";
import { hasManagePermission } from "@/lib/settings/members";
import { hasServiceKey } from "@/lib/supabase/service";
import { resolveUserEmails } from "@/lib/users";
import type { Metadata } from "next";
import { changeRole, inviteMember, removeMember, revokeInvitation, setManagePermission } from "./actions";

export const metadata: Metadata = { title: "Utenti" };

export default async function UsersSettingsPage() {
  const { supabase, org, session, demo } = await requireOrg();
  const organizationId = org.organization.id;
  const [membersResult, invitationsResult] = await Promise.all([
    supabase.from("memberships").select("*").eq("organization_id", organizationId).order("created_at"),
    supabase
      .from("invitations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const members = membersResult.data ?? [];
  const invitations = (invitationsResult.data ?? []).filter((invitation) => invitation.status !== "accepted");
  // Mail addresses live in Auth: only managers see them, and only with the service key.
  const emails = org.canManage
    ? await resolveUserEmails(members.map((m) => m.user_id))
    : new Map<string, string>();
  const display = (userId: string) =>
    userId === session.user.id ? session.user.email : (emails.get(userId) ?? `Utente ${shortId(userId)}`);

  return (
    <>
      <PageHeader
        title="Utenti"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Titolare: gestisce tutto. Collaboratore: usa inbox, contatti e trattative, senza toccare collegamenti e flussi."
      />
      <SettingsNav current="utenti" />
      {!org.canManage ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE} Qui vedi solo il tuo accesso.
        </Notice>
      ) : !demo && !hasServiceKey() ? (
        <Notice tone="warning" className="mb-4" title="Indirizzi mail non disponibili">
          Su questo server manca SUPABASE_SERVICE_ROLE_KEY: gli altri utenti compaiono con un codice al posto
          della mail e gli inviti vengono registrati senza inviare la mail automatica.
        </Notice>
      ) : null}
      {membersResult.error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(membersResult.error)}
        </Notice>
      ) : null}

      <div className="grid gap-4">
        <Card aria-labelledby="persone">
          <CardHeader id="persone" title="Persone con accesso" />
          <ul className="grid gap-4">
            {members.map((member) => {
              const owner = member.role === "org_owner";
              const manage = hasManagePermission(member.permissions);
              const self = member.user_id === session.user.id;
              return (
                <li
                  key={member.id}
                  className="grid gap-3 border-b border-line pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 break-all text-sm font-semibold">
                      {display(member.user_id)}
                      {self ? <span className="font-normal text-muted"> (tu)</span> : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={owner ? "ok" : "neutral"}>{roleLabel(member.role)}</Badge>
                      {!owner && manage ? <Badge>Gestisce collegamenti e flussi</Badge> : null}
                      <span className="font-mono text-[12px] text-muted">
                        dal {formatDate(member.created_at)}
                      </span>
                    </p>
                  </div>
                  {org.canManage ? (
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                      <ActionForm action={changeRole.bind(null, member.id)} className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor={`role-${member.id}`} className="sr-only">
                            Ruolo di {display(member.user_id)}
                          </label>
                          <Select
                            id={`role-${member.id}`}
                            name="role"
                            defaultValue={member.role}
                            className="h-8 w-auto text-[13px]"
                          >
                            <option value="org_owner">Titolare</option>
                            <option value="org_member">Collaboratore</option>
                          </Select>
                          <SubmitButton size="sm" variant="secondary">
                            Cambia ruolo
                          </SubmitButton>
                        </div>
                      </ActionForm>
                      {!owner ? (
                        <ActionForm
                          action={setManagePermission.bind(null, member.id, !manage)}
                          className="grid gap-2"
                        >
                          <SubmitButton size="sm" variant="secondary">
                            {manage
                              ? "Togli la gestione di collegamenti e flussi"
                              : "Può gestire collegamenti e flussi"}
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      <Dialog
                        triggerLabel="Togli"
                        triggerSize="sm"
                        triggerVariant="ghost"
                        title={`Togliere ${display(member.user_id)}?`}
                        description={
                          self
                            ? "Stai togliendo te stesso: non potrai più entrare in questa azienda."
                            : "Non potrà più entrare in questa azienda. Le conversazioni e le trattative che seguiva restano."
                        }
                      >
                        <ActionForm action={removeMember.bind(null, member.id)} className="grid gap-3">
                          <SubmitButton variant="danger">Togli dall'azienda</SubmitButton>
                        </ActionForm>
                      </Dialog>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {members.length === 0 ? (
            <p className="text-sm text-muted">
              {org.mode === "support"
                ? "Nessun utente: invita il titolare qui sotto."
                : "Nessun utente da mostrare."}
            </p>
          ) : null}
        </Card>

        {org.canManage ? (
          <Card aria-labelledby="invita">
            <CardHeader
              id="invita"
              title="Invita una persona"
              description="Riceve una mail con un link: sceglie la password ed entra. Se ha già un account, entra al prossimo accesso."
            />
            <ActionForm
              action={inviteMember}
              className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-start"
            >
              <Field label="Mail" htmlFor="invite-email" name="email">
                <Input id="invite-email" name="email" type="email" autoComplete="off" required />
              </Field>
              <Field label="Ruolo" htmlFor="invite-role" name="role">
                <Select id="invite-role" name="role" defaultValue="org_member">
                  <option value="org_member">Collaboratore</option>
                  <option value="org_owner">Titolare</option>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton icon="mail">Invita</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {invitations.length > 0 ? (
          <Card aria-labelledby="inviti">
            <CardHeader id="inviti" title="Inviti" />
            <ul className="grid gap-3">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm"
                >
                  <span className="min-w-0 break-all">
                    <span className="font-semibold">{invitation.email}</span>
                    <span className="text-muted">
                      {" "}
                      · {roleLabel(invitation.role)} · {formatDate(invitation.created_at)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill {...invitationStatus(invitation.status)} />
                    {org.canManage && invitation.status === "pending" ? (
                      <ActionForm action={revokeInvitation.bind(null, invitation.id)} className="grid gap-2">
                        <SubmitButton size="sm" variant="ghost">
                          Revoca
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
