-- IA Connect: self-registration with admin approval.
-- Anyone can create an account (Supabase Auth, shared with another application) and ask for
-- access; nothing exists for them in IA Connect until a platform admin approves the request,
-- which creates the organization and makes the requester its owner.
-- The table is written only by the two functions below: no direct insert/update/delete.

create table ia_connect.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text,
  company_name text not null,
  -- Same values as organizations.sector (SECTORS in packages/core/src/domain.ts; a test compares them).
  sector text not null default 'other' check (sector in ('insurance', 'ecommerce', 'real_estate', 'other')),
  phone text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  -- Set on approval. Not a tenant column: the row belongs to the requesting user.
  organization_id uuid references ia_connect.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_sizes check (
    length(company_name) between 2 and 120
    and length(coalesce(full_name, '')) <= 120
    and length(coalesce(phone, '')) <= 40
    and length(coalesce(message, '')) <= 1000
    and length(coalesce(decision_note, '')) <= 1000
  )
);
create index on ia_connect.access_requests (status, created_at);

create trigger set_updated_at before update on ia_connect.access_requests
  for each row execute function ia_connect.set_updated_at();

alter table ia_connect.access_requests enable row level security;

-- A user reads their own request; platform admins read all. Reseller admins: none for now.
create policy request_read on ia_connect.access_requests for select to authenticated
  using (user_id = auth.uid() or ia_connect.is_platform_admin());

-- The schema's default privileges grant every table to `authenticated`: take the writes back.
revoke insert, update, delete on ia_connect.access_requests from authenticated;

-- ── Asking for access ──────────────────────────────────────────────────
-- Creates the caller's request, or rewrites it while it is pending or after a rejection
-- (which puts it back to pending). Error codes read by the web app:
--   IAC10 the email of the account is not confirmed
--   IAC11 the caller already belongs to an organization (or is staff), or was already approved
--   22023 a value is missing, too long or not allowed

create or replace function ia_connect.request_access(
  p_full_name text,
  p_company_name text,
  p_sector text,
  p_phone text,
  p_message text
) returns ia_connect.access_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_company text := btrim(coalesce(p_company_name, ''));
  v_sector text := coalesce(nullif(btrim(coalesce(p_sector, '')), ''), 'other');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_row ia_connect.access_requests;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Auth is shared with another application where anyone can sign up with any address.
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'the email of this account is not confirmed' using errcode = 'IAC10';
  end if;
  if length(v_company) < 2 or length(v_company) > 120 then
    raise exception 'company name must be between 2 and 120 characters' using errcode = '22023';
  end if;
  if length(coalesce(v_full_name, '')) > 120 or length(coalesce(v_phone, '')) > 40
     or length(coalesce(v_message, '')) > 1000 then
    raise exception 'a text is too long' using errcode = '22023';
  end if;
  if v_sector not in ('insurance', 'ecommerce', 'real_estate', 'other') then
    raise exception 'unknown sector' using errcode = '22023';
  end if;
  if exists (select 1 from ia_connect.memberships m where m.user_id = v_uid) then
    raise exception 'this user already has access' using errcode = 'IAC11';
  end if;

  insert into ia_connect.access_requests as r (user_id, full_name, company_name, sector, phone, message)
  values (v_uid, v_full_name, v_company, v_sector, v_phone, v_message)
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    company_name = excluded.company_name,
    sector = excluded.sector,
    phone = excluded.phone,
    message = excluded.message,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    decision_note = null
  where r.status in ('pending', 'rejected')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'this request was already approved' using errcode = 'IAC11';
  end if;
  return v_row;
end $$;
revoke execute on function ia_connect.request_access(text, text, text, text, text) from public;
grant execute on function ia_connect.request_access(text, text, text, text, text) to authenticated;

-- ── Deciding ───────────────────────────────────────────────────────────
-- Platform admins only. Approval creates the organization under the default reseller with
-- the chosen plan and makes the requester its owner; the `audit` triggers on organizations
-- and memberships record the admin (auth.uid()) as the actor. Error codes:
--   IAC12 the request is not pending any more
--   22023 unknown or inactive plan, note too long

create or replace function ia_connect.decide_access_request(
  p_request uuid,
  p_approve boolean,
  p_plan_key text default 'starter',
  p_note text default null
) returns ia_connect.access_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_req ia_connect.access_requests;
  v_reseller uuid;
  v_plan uuid;
  v_org uuid;
begin
  if v_uid is null or not ia_connect.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'a decision is required' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'the note is too long' using errcode = '22023';
  end if;

  select * into v_req from ia_connect.access_requests where id = p_request for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_req.user_id = v_uid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = 'IAC12';
  end if;

  if p_approve then
    select id into v_reseller from ia_connect.resellers where slug = 'default';
    select id into v_plan from ia_connect.plans where key = coalesce(p_plan_key, 'starter') and is_active;
    if v_reseller is null or v_plan is null then
      raise exception 'unknown plan or missing default reseller' using errcode = '22023';
    end if;
    insert into ia_connect.organizations (reseller_id, name, sector, plan_id)
    values (v_reseller, v_req.company_name, v_req.sector, v_plan)
    returning id into v_org;
    insert into ia_connect.memberships (user_id, organization_id, role)
    values (v_req.user_id, v_org, 'org_owner');
  end if;

  update ia_connect.access_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_uid,
    decided_at = now(),
    decision_note = v_note,
    organization_id = v_org
  where id = v_req.id
  returning * into v_req;

  insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, entity_type, entity_id, data)
  values (
    v_org, 'admin', v_uid,
    case when p_approve then 'access_request.approve' else 'access_request.reject' end,
    'access_requests', v_req.id,
    jsonb_build_object('company_name', v_req.company_name, 'requested_by', v_req.user_id)
  );
  return v_req;
end $$;
revoke execute on function ia_connect.decide_access_request(uuid, boolean, text, text) from public;
grant execute on function ia_connect.decide_access_request(uuid, boolean, text, text) to authenticated;
