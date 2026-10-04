-- IA Connect: access helpers, row level security, immutability, audit triggers.

-- ── Access helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on `memberships` do not recurse.

create or replace function ia_connect.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from ia_connect.memberships m
    where m.user_id = auth.uid() and m.role = 'platform_admin'
  );
$$;

create or replace function ia_connect.has_reseller_access(p_reseller uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ia_connect.is_platform_admin() or exists (
    select 1 from ia_connect.memberships m
    where m.user_id = auth.uid() and m.role = 'reseller_admin' and m.reseller_id = p_reseller
  );
$$;

-- Can read the organization's data.
create or replace function ia_connect.has_org_access(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ia_connect.is_platform_admin()
    or exists (
      select 1 from ia_connect.memberships m
      where m.user_id = auth.uid() and m.organization_id = p_org
    )
    or exists (
      select 1 from ia_connect.memberships m
      join ia_connect.organizations o on o.reseller_id = m.reseller_id
      where m.user_id = auth.uid() and m.role = 'reseller_admin' and o.id = p_org
    );
$$;

-- Can change connections, flows, settings and users of the organization.
create or replace function ia_connect.can_manage_org(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ia_connect.is_platform_admin()
    or exists (
      select 1 from ia_connect.memberships m
      where m.user_id = auth.uid() and m.organization_id = p_org
        and (m.role = 'org_owner' or coalesce((m.permissions ->> 'manage')::boolean, false))
    )
    or exists (
      select 1 from ia_connect.memberships m
      join ia_connect.organizations o on o.reseller_id = m.reseller_id
      where m.user_id = auth.uid() and m.role = 'reseller_admin' and o.id = p_org
    );
$$;

-- Platform or reseller staff (not the customer) for this organization.
create or replace function ia_connect.is_org_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ia_connect.is_platform_admin() or exists (
    select 1 from ia_connect.memberships m
    join ia_connect.organizations o on o.reseller_id = m.reseller_id
    where m.user_id = auth.uid() and m.role = 'reseller_admin' and o.id = p_org
  );
$$;

-- ── Row level security ─────────────────────────────────────────────────

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'ia_connect' loop
    execute format('alter table ia_connect.%I enable row level security', t);
  end loop;
end $$;

-- Customer tables managed by owners: everyone in the organization reads, managers write.
do $$
declare t text;
begin
  foreach t in array array[
    'org_settings', 'connections', 'flows', 'message_templates', 'deal_stages',
    'scrape_recipes', 'scrape_recipe_versions', 'invitations'
  ] loop
    execute format('create policy org_read on ia_connect.%I for select to authenticated using (ia_connect.has_org_access(organization_id))', t);
    execute format('create policy org_insert on ia_connect.%I for insert to authenticated with check (ia_connect.can_manage_org(organization_id))', t);
    execute format('create policy org_update on ia_connect.%I for update to authenticated using (ia_connect.can_manage_org(organization_id)) with check (ia_connect.can_manage_org(organization_id))', t);
    execute format('create policy org_delete on ia_connect.%I for delete to authenticated using (ia_connect.can_manage_org(organization_id))', t);
  end loop;
end $$;

-- Customer tables used day to day: every member reads and writes.
do $$
declare t text;
begin
  foreach t in array array[
    'contacts', 'conversations', 'messages', 'deals', 'deal_events', 'appointments',
    'notifications', 'approvals'
  ] loop
    execute format('create policy org_read on ia_connect.%I for select to authenticated using (ia_connect.has_org_access(organization_id))', t);
    execute format('create policy org_insert on ia_connect.%I for insert to authenticated with check (ia_connect.has_org_access(organization_id))', t);
    execute format('create policy org_update on ia_connect.%I for update to authenticated using (ia_connect.has_org_access(organization_id)) with check (ia_connect.has_org_access(organization_id))', t);
    execute format('create policy org_delete on ia_connect.%I for delete to authenticated using (ia_connect.has_org_access(organization_id))', t);
  end loop;
end $$;

-- Tables written by the worker (service role): customers only read.
do $$
declare t text;
begin
  foreach t in array array[
    'events', 'flow_runs', 'flow_run_steps', 'scheduled_jobs', 'scrape_runs', 'usage_counters',
    'ai_calls', 'payment_requests', 'signature_requests', 'support_sessions', 'org_features', 'flow_versions'
  ] loop
    execute format('create policy org_read on ia_connect.%I for select to authenticated using (ia_connect.has_org_access(organization_id))', t);
  end loop;
end $$;

-- Managers can queue a test event, save a new flow version and request a scrape run.
create policy org_insert on ia_connect.events for insert to authenticated
  with check (ia_connect.can_manage_org(organization_id));
create policy org_insert on ia_connect.flow_versions for insert to authenticated
  with check (ia_connect.can_manage_org(organization_id));
create policy org_insert on ia_connect.scheduled_jobs for insert to authenticated
  with check (ia_connect.can_manage_org(organization_id));

-- Feature flags and support sessions belong to platform and reseller staff.
create policy staff_write on ia_connect.org_features for all to authenticated
  using (ia_connect.is_org_staff(organization_id)) with check (ia_connect.is_org_staff(organization_id));
create policy staff_insert on ia_connect.support_sessions for insert to authenticated
  with check (ia_connect.is_org_staff(organization_id) and admin_user_id = auth.uid());
create policy staff_update on ia_connect.support_sessions for update to authenticated
  using (ia_connect.is_org_staff(organization_id) and admin_user_id = auth.uid())
  with check (ia_connect.is_org_staff(organization_id));

-- connection_secrets: no policy on purpose. Only the service role reads it.

-- organizations
create policy org_read on ia_connect.organizations for select to authenticated
  using (ia_connect.has_org_access(id));
create policy staff_insert on ia_connect.organizations for insert to authenticated
  with check (ia_connect.has_reseller_access(reseller_id));
create policy staff_update on ia_connect.organizations for update to authenticated
  using (ia_connect.has_reseller_access(reseller_id)) with check (ia_connect.has_reseller_access(reseller_id));
create policy admin_delete on ia_connect.organizations for delete to authenticated
  using (ia_connect.is_platform_admin());

-- memberships
create policy member_read on ia_connect.memberships for select to authenticated
  using (
    user_id = auth.uid()
    or (organization_id is not null and ia_connect.can_manage_org(organization_id))
    or (reseller_id is not null and ia_connect.has_reseller_access(reseller_id))
    or ia_connect.is_platform_admin()
  );
create policy member_insert on ia_connect.memberships for insert to authenticated
  with check (
    ia_connect.is_platform_admin()
    or (role in ('org_owner', 'org_member') and ia_connect.can_manage_org(organization_id))
  );
create policy member_update on ia_connect.memberships for update to authenticated
  using (ia_connect.is_platform_admin() or (role in ('org_owner', 'org_member') and ia_connect.can_manage_org(organization_id)))
  with check (ia_connect.is_platform_admin() or (role in ('org_owner', 'org_member') and ia_connect.can_manage_org(organization_id)));
create policy member_delete on ia_connect.memberships for delete to authenticated
  using (ia_connect.is_platform_admin() or (role in ('org_owner', 'org_member') and ia_connect.can_manage_org(organization_id)));

-- resellers
create policy reseller_read on ia_connect.resellers for select to authenticated
  using (ia_connect.has_reseller_access(id));
create policy reseller_write on ia_connect.resellers for all to authenticated
  using (ia_connect.is_platform_admin()) with check (ia_connect.is_platform_admin());

-- Platform catalogs: readable by every signed-in user, written by platform admins.
create policy catalog_read on ia_connect.plans for select to authenticated using (true);
create policy catalog_write on ia_connect.plans for all to authenticated
  using (ia_connect.is_platform_admin()) with check (ia_connect.is_platform_admin());
create policy catalog_read on ia_connect.connector_types for select to authenticated using (true);
create policy catalog_write on ia_connect.connector_types for all to authenticated
  using (ia_connect.is_platform_admin()) with check (ia_connect.is_platform_admin());
create policy catalog_read on ia_connect.flow_templates for select to authenticated
  using (is_published or ia_connect.is_platform_admin());
create policy catalog_write on ia_connect.flow_templates for all to authenticated
  using (ia_connect.is_platform_admin()) with check (ia_connect.is_platform_admin());

-- audit_log: readable by the organization, insert only.
create policy audit_read on ia_connect.audit_log for select to authenticated
  using (
    (organization_id is not null and ia_connect.has_org_access(organization_id))
    or ia_connect.is_platform_admin()
  );
create policy audit_insert on ia_connect.audit_log for insert to authenticated
  with check (actor_id = auth.uid() and organization_id is not null and ia_connect.has_org_access(organization_id));

-- ── Immutability ───────────────────────────────────────────────────────

create or replace function ia_connect.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% on %.% is not allowed: rows are immutable', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger audit_log_immutable before update or delete on ia_connect.audit_log
  for each row execute function ia_connect.forbid_change();

-- flow_versions: never updated; deleted only by cascade when the flow or organization goes.
create or replace function ia_connect.flow_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'flow_versions are immutable' using errcode = 'P0001';
  end if;
  if pg_trigger_depth() < 2 then
    raise exception 'flow_versions can only be removed together with their flow' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger flow_versions_immutable before update or delete on ia_connect.flow_versions
  for each row execute function ia_connect.flow_versions_guard();
drop trigger set_updated_at on ia_connect.flow_versions;

-- ── Automatic audit trail ──────────────────────────────────────────────
-- Every change to the tables below is logged with its actor. The worker
-- (service role, no auth.uid()) is logged as "automation".

create or replace function ia_connect.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_org uuid := coalesce((v_row ->> 'organization_id')::uuid, case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end);
  v_uid uuid := auth.uid();
  v_staff boolean := v_uid is not null and v_org is not null and ia_connect.is_org_staff(v_org);
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

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'memberships', 'invitations', 'org_settings', 'org_features', 'connections',
    'flows', 'flow_versions', 'message_templates', 'deal_stages', 'deals', 'contacts',
    'scrape_recipes', 'approvals', 'support_sessions'
  ] loop
    execute format('create trigger audit after insert or update or delete on ia_connect.%I for each row execute function ia_connect.write_audit()', t);
  end loop;
end $$;

-- Outbound messages typed by a person are audited too.
create trigger audit after insert on ia_connect.messages
  for each row when (new.direction = 'out' and new.sent_by_user_id is not null)
  execute function ia_connect.write_audit();

-- ── Grants ─────────────────────────────────────────────────────────────

grant usage on schema ia_connect to authenticated, service_role;
grant select, insert, update, delete on all tables in schema ia_connect to authenticated;
grant all on all tables in schema ia_connect to service_role;
revoke all on ia_connect.connection_secrets from authenticated;
alter default privileges in schema ia_connect grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema ia_connect grant all on tables to service_role;
