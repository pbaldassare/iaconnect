-- IA Connect: security hardening after the audit of 2026-10-04.
-- RLS only looked at `organization_id` of the row being written. This migration makes the
-- database itself refuse what the web server actions already refused:
--   1. connections are written by the server only (routing data decides who receives a webhook);
--   2. every reference between customer tables stays inside one organization (composite FKs);
--   3. customers can insert only harmless events and jobs, in limited number;
--   4. audit rows, invitations, support sessions, flows and messages get the missing checks.

-- ── Helpers with an explicit user ──────────────────────────────────────
-- Same rules as is_platform_admin / is_org_staff / can_manage_org, for code that runs as the
-- service role on behalf of a user (no auth.uid()). Never callable by customers: they would
-- reveal other people's roles.

create or replace function ia_connect.user_is_org_staff(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    exists (select 1 from ia_connect.memberships m where m.user_id = p_user and m.role = 'platform_admin')
    or exists (
      select 1 from ia_connect.memberships m
      join ia_connect.organizations o on o.reseller_id = m.reseller_id
      where m.user_id = p_user and m.role = 'reseller_admin' and o.id = p_org
    )
  );
$$;

create or replace function ia_connect.user_can_manage_org(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    ia_connect.user_is_org_staff(p_user, p_org)
    or exists (
      select 1 from ia_connect.memberships m
      where m.user_id = p_user and m.organization_id = p_org
        and (m.role = 'org_owner' or coalesce((m.permissions ->> 'manage')::boolean, false))
    )
  );
$$;

revoke execute on function ia_connect.user_is_org_staff(uuid, uuid) from public, authenticated;
revoke execute on function ia_connect.user_can_manage_org(uuid, uuid) from public, authenticated;
grant execute on function ia_connect.user_is_org_staff(uuid, uuid) to service_role;
grant execute on function ia_connect.user_can_manage_org(uuid, uuid) to service_role;

-- ── Audit trail: the real actor of server-side writes ──────────────────
-- A write made by the service role on behalf of a user sets the transaction-local setting
-- `ia_connect.actor_id`; the trigger records that user instead of "automation". The setting
-- is read only when there is no auth.uid(), so a signed-in user cannot pose as someone else.

create or replace function ia_connect.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_org uuid := coalesce((v_row ->> 'organization_id')::uuid, case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end);
  v_uid uuid := coalesce(auth.uid(), nullif(current_setting('ia_connect.actor_id', true), '')::uuid);
  v_staff boolean := v_uid is not null and v_org is not null and ia_connect.user_is_org_staff(v_uid, v_org);
begin
  insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, entity_type, entity_id, data, is_support_access)
  values (
    v_org,
    case when v_uid is null then 'automation' when v_staff then 'admin' else 'user' end,
    v_uid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', (
      select coalesce(jsonb_agg(n.key), '[]'::jsonb)
      from jsonb_each(to_jsonb(new)) n
      where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key)
    )) else '{}'::jsonb end,
    v_staff and tg_table_name <> 'organizations'
  );
  return null;
end $$;

-- Explicit audit entries: the caller says what happened, the database says who did it.
-- (The old insert policy only pinned actor_id: a member could log as "admin" or back-date a row.)
drop policy audit_insert on ia_connect.audit_log;
revoke insert, update, delete on ia_connect.audit_log from authenticated;

create or replace function ia_connect.log_action(
  p_org uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_data jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff boolean;
begin
  if auth.uid() is null or p_org is null or not ia_connect.has_org_access(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- `<table>.<insert|update|delete>` is what the triggers write: never accepted from a caller.
  if p_action is null or p_action !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$' or length(p_action) > 80
     or p_action ~ '\.(insert|update|delete)$' then
    raise exception 'invalid audit action' using errcode = '22023';
  end if;
  if pg_column_size(coalesce(p_data, '{}'::jsonb)) > 8192 or length(coalesce(p_entity_type, '')) > 80 then
    raise exception 'audit entry too large' using errcode = '22023';
  end if;
  v_staff := ia_connect.is_org_staff(p_org);
  insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, entity_type, entity_id, data, is_support_access)
  values (p_org, case when v_staff then 'admin' else 'user' end, auth.uid(), p_action, p_entity_type, p_entity_id,
          coalesce(p_data, '{}'::jsonb), v_staff);
end $$;
revoke execute on function ia_connect.log_action(uuid, text, text, uuid, jsonb) from public;
grant execute on function ia_connect.log_action(uuid, text, text, uuid, jsonb) to authenticated;

-- ── Connections: written by the server only ────────────────────────────
-- `external_account_id`, `config` and `webhook_token` decide which organization receives an
-- inbound webhook. Customers keep reading their connections and may rename them; everything
-- else goes through save_connection(), called by the web server with the service role after
-- `connector.connect` proved that the account belongs to the caller.

drop policy org_insert on ia_connect.connections;
drop policy org_delete on ia_connect.connections;
revoke insert, update, delete on ia_connect.connections from authenticated;
grant update (name) on ia_connect.connections to authenticated;

-- One live connection per provider account. Not for connectors where the "account" is
-- legitimately shared: a public site read by several customers, a Twilio account with more
-- numbers, a Google account with more calendars (none of them routes shared webhooks).
create unique index connections_external_account_unique
  on ia_connect.connections (connector_type, external_account_id)
  where external_account_id is not null and status <> 'disconnected'
    and connector_type not in ('scraper_site', 'sms_twilio', 'google_calendar');

-- Creates (p_connection null) or updates a connection on behalf of p_actor, who must be a
-- manager of the organization. p_values keys: connector_type (insert only), name, config,
-- external_account_id, status, last_error, last_checked_at. Absent keys are left untouched.
create or replace function ia_connect.save_connection(
  p_actor uuid,
  p_organization uuid,
  p_connection uuid,
  p_values jsonb
) returns ia_connect.connections
language plpgsql security definer set search_path = '' as $$
declare
  v_row ia_connect.connections;
  v_type text := p_values ->> 'connector_type';
begin
  if not ia_connect.user_can_manage_org(p_actor, p_organization) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform set_config('ia_connect.actor_id', p_actor::text, true);

  if p_connection is null then
    -- The catalog and the plan are enforced here too, not only in the page.
    if not exists (
      select 1 from ia_connect.connector_types t, ia_connect.organizations o
      join ia_connect.plans p on p.id = o.plan_id
      where t.key = v_type and o.id = p_organization and t.is_enabled
        and (t.allowed_plans is null or p.key = any (t.allowed_plans))
    ) then
      raise exception 'connector type not available for this organization' using errcode = '42501';
    end if;
    insert into ia_connect.connections
      (organization_id, connector_type, name, config, external_account_id, status, last_error, last_checked_at)
    values (
      p_organization, v_type, coalesce(nullif(p_values ->> 'name', ''), v_type),
      coalesce(p_values -> 'config', '{}'::jsonb), p_values ->> 'external_account_id',
      coalesce(p_values ->> 'status', 'active'), p_values ->> 'last_error',
      (p_values ->> 'last_checked_at')::timestamptz
    ) returning * into v_row;
    return v_row;
  end if;

  update ia_connect.connections c set
    name = case when p_values ? 'name' and coalesce(p_values ->> 'name', '') <> '' then p_values ->> 'name' else c.name end,
    config = case when p_values ? 'config' then coalesce(p_values -> 'config', '{}'::jsonb) else c.config end,
    external_account_id = case when p_values ? 'external_account_id' then p_values ->> 'external_account_id' else c.external_account_id end,
    status = case when p_values ? 'status' then p_values ->> 'status' else c.status end,
    last_error = case when p_values ? 'last_error' then p_values ->> 'last_error' else c.last_error end,
    last_checked_at = case when p_values ? 'last_checked_at' then (p_values ->> 'last_checked_at')::timestamptz else c.last_checked_at end
  where c.id = p_connection and c.organization_id = p_organization
  returning * into v_row;
  if v_row.id is null then
    raise exception 'connection not found in the organization' using errcode = 'P0002';
  end if;
  return v_row;
end $$;

-- Takes back a connection whose secrets could not be stored.
create or replace function ia_connect.remove_connection(p_actor uuid, p_organization uuid, p_connection uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ia_connect.user_can_manage_org(p_actor, p_organization) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform set_config('ia_connect.actor_id', p_actor::text, true);
  delete from ia_connect.connections where id = p_connection and organization_id = p_organization;
end $$;

revoke execute on function ia_connect.save_connection(uuid, uuid, uuid, jsonb) from public, authenticated;
revoke execute on function ia_connect.remove_connection(uuid, uuid, uuid) from public, authenticated;
grant execute on function ia_connect.save_connection(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ia_connect.remove_connection(uuid, uuid, uuid) to service_role;

-- ── Tenant-scoped foreign keys ─────────────────────────────────────────
-- A row of organization A could reference a conversation, contact, flow, run or connection
-- of organization B. Every reference between customer tables now carries organization_id.
-- ON DELETE behaviours are unchanged; SET NULL clears the reference column only.

do $$
declare
  t text;
  r record;
  v_old text;
  v_action text;
begin
  foreach t in array array[
    'connections', 'events', 'flows', 'flow_versions', 'contacts', 'conversations', 'deal_stages',
    'flow_runs', 'flow_run_steps', 'scrape_recipes', 'scrape_recipe_versions', 'message_templates', 'deals'
  ] loop
    execute format('alter table ia_connect.%I add constraint %I unique (organization_id, id)', t, t || '_org_id_key');
  end loop;

  for r in
    select * from (values
      ('connection_secrets', 'connection_id', 'connections', 'cascade'),
      ('events', 'connection_id', 'connections', 'set null'),
      ('flow_versions', 'flow_id', 'flows', 'cascade'),
      ('flows', 'active_version_id', 'flow_versions', 'set null'),
      ('conversations', 'contact_id', 'contacts', 'cascade'),
      ('conversations', 'connection_id', 'connections', 'set null'),
      ('flow_runs', 'flow_id', 'flows', 'cascade'),
      ('flow_runs', 'flow_version_id', 'flow_versions', 'cascade'),
      ('flow_runs', 'event_id', 'events', 'set null'),
      ('flow_runs', 'contact_id', 'contacts', 'set null'),
      ('flow_runs', 'conversation_id', 'conversations', 'set null'),
      ('flow_runs', 'deal_id', 'deals', 'set null'),
      ('flow_run_steps', 'flow_run_id', 'flow_runs', 'cascade'),
      ('scheduled_jobs', 'flow_run_id', 'flow_runs', 'cascade'),
      ('scrape_recipes', 'connection_id', 'connections', 'set null'),
      ('scrape_recipes', 'active_version_id', 'scrape_recipe_versions', 'set null'),
      ('scrape_recipe_versions', 'recipe_id', 'scrape_recipes', 'cascade'),
      ('scrape_runs', 'recipe_id', 'scrape_recipes', 'cascade'),
      ('scrape_runs', 'recipe_version_id', 'scrape_recipe_versions', 'set null'),
      ('messages', 'conversation_id', 'conversations', 'cascade'),
      ('messages', 'template_id', 'message_templates', 'set null'),
      ('messages', 'flow_run_id', 'flow_runs', 'set null'),
      ('deals', 'contact_id', 'contacts', 'cascade'),
      ('deals', 'stage_id', 'deal_stages', 'no action'),
      ('deals', 'origin_flow_run_id', 'flow_runs', 'set null'),
      ('deal_events', 'deal_id', 'deals', 'cascade'),
      ('approvals', 'flow_run_id', 'flow_runs', 'cascade'),
      ('appointments', 'contact_id', 'contacts', 'cascade'),
      ('appointments', 'deal_id', 'deals', 'set null'),
      ('appointments', 'connection_id', 'connections', 'set null'),
      ('payment_requests', 'contact_id', 'contacts', 'cascade'),
      ('payment_requests', 'deal_id', 'deals', 'set null'),
      ('payment_requests', 'connection_id', 'connections', 'set null'),
      ('signature_requests', 'contact_id', 'contacts', 'cascade'),
      ('signature_requests', 'deal_id', 'deals', 'set null'),
      ('signature_requests', 'connection_id', 'connections', 'set null'),
      ('ai_calls', 'flow_run_id', 'flow_runs', 'set null'),
      ('ai_calls', 'flow_run_step_id', 'flow_run_steps', 'set null')
    ) as refs (child, col, parent, action)
  loop
    -- The single-column constraint this one replaces.
    for v_old in
      select c.conname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.conrelid = format('ia_connect.%I', r.child)::regclass
        and array_length(c.conkey, 1) = 1 and a.attname = r.col
    loop
      execute format('alter table ia_connect.%I drop constraint %I', r.child, v_old);
    end loop;
    v_action := case r.action when 'set null' then format('set null (%I)', r.col) else r.action end;
    execute format(
      'alter table ia_connect.%I add constraint %I foreign key (organization_id, %I) references ia_connect.%I (organization_id, id) on delete %s',
      r.child, r.child || '_' || r.col || '_org_fk', r.col, r.parent, v_action);
  end loop;
end $$;

-- ── Events and jobs inserted by customers ──────────────────────────────

-- Event types a customer (test event, generic webhook, logic.for_each) may create. Everything
-- else is produced only by a connector that verified its origin: an inbound message opens the
-- WhatsApp window and records consent, a payment event marks a request as paid.
-- Keep in sync with OPEN_EVENT_TYPES in packages/core/src/events.ts (a test compares them).
create or replace function ia_connect.is_open_event_type(p_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_type in ('quote.requested', 'order.created', 'listing.published', 'crm.record.created', 'crm.record.updated')
    or p_type ~ '^custom\.[a-z0-9_.]+$';
$$;

alter table ia_connect.events add column created_by uuid default auth.uid();

drop policy org_insert on ia_connect.events;
create policy org_insert on ia_connect.events for insert to authenticated
  with check (
    ia_connect.can_manage_org(organization_id)
    and created_by = auth.uid()
    and status = 'pending' and attempts = 0 and locked_until is null and processed_at is null and error is null
    and (type = 'manual.test' or ia_connect.is_open_event_type(type))
  );

-- Jobs: the worker's own dedupe keys (poll:…, verify:…, scrape:…, report:…, recover:…) cannot
-- be taken by a customer, who would otherwise keep the worker's recurring job from existing.
drop policy org_insert on ia_connect.scheduled_jobs;
create policy org_insert on ia_connect.scheduled_jobs for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
    and attempts = 0
    and locked_until is null
    and flow_run_id is null
    and (dedupe_key is null or dedupe_key like 'user:%')
    and (
      (kind in ('send_message', 'approval_decided') and ia_connect.has_org_access(organization_id))
      or (kind in ('simulate_flow', 'scrape_run', 'scrape_trace', 'verify_connection') and ia_connect.can_manage_org(organization_id))
    )
  );

-- Fairness: one organization cannot fill the queue everybody shares.
create or replace function ia_connect.cap_user_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if new.created_by is null then return new; end if;
  if tg_table_name = 'scheduled_jobs' then
    select count(*) into v_count from ia_connect.scheduled_jobs
    where organization_id = new.organization_id and created_by is not null and status in ('pending', 'running');
    if v_count >= 50 then
      raise exception 'too many pending jobs requested by this organization' using errcode = 'IAC01';
    end if;
  else
    select count(*) into v_count from ia_connect.events
    where organization_id = new.organization_id and created_by is not null and status in ('pending', 'processing');
    if v_count >= 100 then
      raise exception 'too many pending events inserted by this organization' using errcode = 'IAC01';
    end if;
  end if;
  return new;
end $$;
create trigger cap_user_rows before insert on ia_connect.scheduled_jobs
  for each row execute function ia_connect.cap_user_rows();
create trigger cap_user_rows before insert on ia_connect.events
  for each row execute function ia_connect.cap_user_rows();

-- ── Messages: history cannot be rewritten ──────────────────────────────
-- Members insert the messages they write and may mark one as failed; they cannot edit what
-- was said, move a message to another conversation or delete single messages. Deleting a
-- contact still removes its conversations and messages (cascade).

create or replace function ia_connect.messages_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
    new.content is distinct from old.content
    or new.direction is distinct from old.direction
    or new.conversation_id is distinct from old.conversation_id
    or new.external_id is distinct from old.external_id
    or new.organization_id is distinct from old.organization_id
    or new.channel is distinct from old.channel
  ) then
    raise exception 'messages cannot be edited' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger messages_guard before update on ia_connect.messages
  for each row execute function ia_connect.messages_guard();

drop policy org_delete on ia_connect.messages;
revoke delete on ia_connect.messages from authenticated;

-- ── Flows: plan limit and version ownership in the database ────────────

create or replace function ia_connect.flows_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit bigint;
  v_active integer;
begin
  if new.active_version_id is not null and not exists (
    select 1 from ia_connect.flow_versions v where v.id = new.active_version_id and v.flow_id = new.id
  ) then
    raise exception 'active_version_id must be a version of this flow' using errcode = '23514';
  end if;
  if new.status = 'active' then
    if new.active_version_id is null then
      raise exception 'an active flow needs an active version' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      -- Serializes concurrent activations of the same organization.
      perform 1 from ia_connect.organizations o where o.id = new.organization_id for update;
      select (p.limits ->> 'active_flows')::bigint into v_limit
      from ia_connect.organizations o join ia_connect.plans p on p.id = o.plan_id
      where o.id = new.organization_id;
      select count(*) into v_active from ia_connect.flows f
      where f.organization_id = new.organization_id and f.status = 'active' and f.id <> new.id;
      if v_limit is not null and v_limit >= 0 and v_active >= v_limit then
        raise exception 'the plan''s active_flows limit is reached' using errcode = 'IAC02';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger flows_guard before insert or update on ia_connect.flows
  for each row execute function ia_connect.flows_guard();

-- ── Invitations: only a confirmed email counts ─────────────────────────
-- Auth is shared with another application where anyone can sign up with any address.

create or replace function ia_connect.accept_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_count integer := 0;
  inv record;
begin
  select lower(email) into v_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for inv in
    select * from ia_connect.invitations where lower(email) = v_email and status = 'pending'
  loop
    insert into ia_connect.memberships (user_id, organization_id, role)
    values (auth.uid(), inv.organization_id, inv.role)
    on conflict do nothing;
    update ia_connect.invitations set status = 'accepted' where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── Support sessions ───────────────────────────────────────────────────

create or replace function ia_connect.support_sessions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.admin_user_id is distinct from old.admin_user_id
     or new.started_at is distinct from old.started_at then
    raise exception 'support sessions cannot be reassigned or back-dated' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger support_sessions_guard before update on ia_connect.support_sessions
  for each row execute function ia_connect.support_sessions_guard();

drop policy staff_update on ia_connect.support_sessions;
create policy staff_update on ia_connect.support_sessions for update to authenticated
  using (ia_connect.is_org_staff(organization_id) and admin_user_id = auth.uid())
  with check (ia_connect.is_org_staff(organization_id) and admin_user_id = auth.uid());

-- ── Functions that took "no user" for "service role" ───────────────────

-- SECURITY INVOKER: RLS decides. A caller who cannot read the organization gets null.
create or replace function ia_connect.quota_left(p_org uuid, p_metric text) returns bigint
language sql stable set search_path = '' as $$
  select case
    when lim.value is null or lim.value < 0 then null
    else greatest(lim.value - coalesce(used.value, 0), 0)
  end
  from (
    select (p.limits ->> (case p_metric
      when 'messages' then 'messages_per_month'
      when 'ai_credits' then 'ai_credits_per_month'
      when 'scrape_runs' then 'scrape_runs_per_month' end))::bigint as value
    from ia_connect.organizations o join ia_connect.plans p on p.id = o.plan_id
    where o.id = p_org
  ) lim
  left join lateral (
    select u.value from ia_connect.usage_counters u
    where u.organization_id = p_org and u.period = ia_connect.usage_period() and u.metric = p_metric
  ) used on true;
$$;

-- Service role only; platform admins go through admin_delete_organization().
create or replace function ia_connect.delete_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  for s in select vault_secret_id from ia_connect.connection_secrets where organization_id = p_org loop
    begin
      delete from vault.secrets where id = s.vault_secret_id;
    exception when undefined_table or invalid_schema_name then null;
    end;
  end loop;
  delete from ia_connect.organizations where id = p_org;
end $$;
revoke execute on function ia_connect.delete_organization(uuid) from public, authenticated;
grant execute on function ia_connect.delete_organization(uuid) to service_role;

create or replace function ia_connect.admin_delete_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not ia_connect.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform ia_connect.delete_organization(p_org);
end $$;
revoke execute on function ia_connect.admin_delete_organization(uuid) from public;
grant execute on function ia_connect.admin_delete_organization(uuid) to authenticated;

-- ── Export without routing tokens ──────────────────────────────────────

create or replace function ia_connect.export_organization(p_org uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_out jsonb := '{}';
  v_rows jsonb;
  t text;
begin
  if not ia_connect.can_manage_org(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object('organization', to_jsonb(o)) into v_out from ia_connect.organizations o where o.id = p_org;
  foreach t in array array[
    'org_settings', 'contacts', 'conversations', 'messages', 'deals', 'deal_stages', 'deal_events',
    'flows', 'flow_versions', 'message_templates', 'connections', 'appointments', 'scrape_recipes',
    'payment_requests', 'signature_requests', 'usage_counters'
  ] loop
    -- webhook_token is a credential (it is the inbound webhook address); the polling cursor
    -- and the last provider error are internal.
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]'') from ia_connect.%I x where x.organization_id = $1',
      case when t = 'connections'
        then '(to_jsonb(x) - ''webhook_token'' - ''last_error'') || jsonb_build_object(''config'', x.config - ''cursor'')'
        else 'to_jsonb(x)' end,
      t)
      into v_rows using p_org;
    v_out := v_out || jsonb_build_object(t, v_rows);
  end loop;
  return v_out;
end $$;

-- ── Flow template: order follow-up ─────────────────────────────────────
-- The seed file 20261004000400 is already applied: the template's ai.reply now reads only the
-- orders of the contact who is writing (readResources.matchContact + fields). Same definition
-- as packages/core/src/flow/templates.ts (a test compares them).
update ia_connect.flow_templates
set definition = '{"trigger":{"event":"mail.received","filters":[{"field":"payload.subject","operator":"contains","value":"ordine"}]},"steps":[{"id":"extract","block":"ai.extract","params":{"text":"{{event.payload.text}}","fields":[{"name":"name","type":"string","description":"Nome del cliente","required":true},{"name":"phone","type":"string","description":"Numero di cellulare","required":true},{"name":"email","type":"string","description":"Indirizzo mail","required":false},{"name":"orderNumber","type":"string","description":"Numero d''ordine","required":true},{"name":"total","type":"number","description":"Totale dell''ordine in euro","required":false}]}},{"id":"contact","block":"contact.upsert","params":{"name":"{{steps.extract.output.data.name}}","phone":"{{steps.extract.output.data.phone}}","email":"{{steps.extract.output.data.email}}","consent":{"channel":"whatsapp","source":"Ordine sul negozio online"}}},{"id":"deal","block":"deal.create","params":{"title":"Ordine {{steps.extract.output.data.orderNumber}}","stage":"new","value":"{{steps.extract.output.data.total}}","fields":{"orderNumber":"{{steps.extract.output.data.orderNumber}}"}}},{"id":"confirm","block":"whatsapp.send_template","params":{"template":"conferma_ordine","variables":{"1":"{{contact.full_name}}","2":"{{steps.extract.output.data.orderNumber}}"}}},{"id":"wait_reply","block":"wait.for_reply","params":{"timeout":"14d"},"onReply":"answer"},{"id":"answer","block":"ai.reply","params":{"scope":"Domande sullo stato dell''ordine, sulla spedizione e sui tempi di consegna.","maxTurns":8,"idleTimeout":"48h","readResources":[{"resource":"orders","description":"Ordini del contatto: cerca per numero d''ordine per leggere stato e spedizione. Vengono restituiti solo gli ordini di chi sta scrivendo.","matchContact":{"field":"phone","by":"phone"},"fields":["orderNumber","status","total","currency","items","trackingUrl","shippedAt"]}]},"next":"end","onHandoff":"notify"},{"id":"notify","block":"human.notify_owner","params":{"message":"{{contact.full_name}} chiede assistenza per l''ordine {{steps.extract.output.data.orderNumber}}."}}]}'::jsonb
where key = 'ecommerce_order_followup';
