-- Platform API keys. A null organization_id sees every client; a set one sees only
-- that organization. The raw key is never stored: only a prefix and a SHA-256 hash.
-- Reads go through the api_* functions (service role). Issuing and revoking stay
-- with a signed-in platform admin, and both write the audit log.

create table ia_connect.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references ia_connect.organizations (id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 80),
  check (key_prefix ~ '^iac_[0-9a-f]{8}$'),
  check (key_hash ~ '^[0-9a-f]{64}$')
);
create index on ia_connect.api_keys (organization_id, created_at desc);

alter table ia_connect.api_keys enable row level security;

create policy api_keys_read on ia_connect.api_keys for select to authenticated
  using (ia_connect.is_platform_admin());

revoke insert, update, delete on ia_connect.api_keys from authenticated;

-- ── Issue and revoke (platform admin, through a session) ───────────────

create or replace function ia_connect.issue_api_key(
  p_name text,
  p_organization uuid,
  p_prefix text,
  p_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(p_name);
  v_id uuid;
begin
  if auth.uid() is null or not ia_connect.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_prefix is null or p_prefix !~ '^iac_[0-9a-f]{8}$' then
    raise exception 'invalid prefix' using errcode = '22023';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hash' using errcode = '22023';
  end if;
  if p_organization is not null and not exists (
    select 1 from ia_connect.organizations o where o.id = p_organization
  ) then
    raise exception 'unknown organization' using errcode = 'P0002';
  end if;
  insert into ia_connect.api_keys (organization_id, name, key_prefix, key_hash, created_by)
  values (p_organization, v_name, p_prefix, p_hash, auth.uid())
  returning id into v_id;
  insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, entity_type, entity_id, data, is_support_access)
  values (
    p_organization,
    'admin',
    auth.uid(),
    'api_keys.issue',
    'api_keys',
    v_id,
    jsonb_build_object(
      'name', v_name,
      'prefix', p_prefix,
      'scope', case when p_organization is null then 'platform' else 'organization' end
    ),
    p_organization is not null
  );
  return v_id;
end $$;

create or replace function ia_connect.revoke_api_key(p_key uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_prefix text;
  v_revoked timestamptz;
begin
  if auth.uid() is null or not ia_connect.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select organization_id, key_prefix, revoked_at into v_org, v_prefix, v_revoked
    from ia_connect.api_keys where id = p_key;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_revoked is not null then
    return;
  end if;
  update ia_connect.api_keys
     set revoked_at = now(), updated_at = now()
   where id = p_key;
  insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, entity_type, entity_id, data, is_support_access)
  values (
    v_org,
    'admin',
    auth.uid(),
    'api_keys.revoke',
    'api_keys',
    p_key,
    jsonb_build_object('prefix', v_prefix),
    v_org is not null
  );
end $$;

revoke execute on function ia_connect.issue_api_key(text, uuid, text, text) from public, anon;
revoke execute on function ia_connect.revoke_api_key(uuid) from public, anon;
grant execute on function ia_connect.issue_api_key(text, uuid, text, text) to authenticated;
grant execute on function ia_connect.revoke_api_key(uuid) to authenticated;

-- ── Reads (service role presents the key hash) ─────────────────────────

create or replace function ia_connect.api_load_key(p_hash text)
returns ia_connect.api_keys
language plpgsql security definer set search_path = '' as $$
declare
  v_key ia_connect.api_keys;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_key from ia_connect.api_keys where key_hash = p_hash and revoked_at is null;
  if not found then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  update ia_connect.api_keys set last_used_at = now() where id = v_key.id;
  return v_key;
end $$;

create or replace function ia_connect.api_organizations(p_hash text)
returns table (id uuid, name text, sector text, status text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_key ia_connect.api_keys;
begin
  v_key := ia_connect.api_load_key(p_hash);
  return query
    select o.id, o.name, o.sector, o.status, o.created_at
      from ia_connect.organizations o
     where v_key.organization_id is null or o.id = v_key.organization_id
     order by o.name;
end $$;

create or replace function ia_connect.api_conversations(
  p_hash text,
  p_organization uuid,
  p_limit integer,
  p_before timestamptz
) returns table (
  id uuid,
  contact_id uuid,
  contact_name text,
  channel text,
  status text,
  last_message_at timestamptz,
  unread_count integer,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_key ia_connect.api_keys;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  v_key := ia_connect.api_load_key(p_hash);
  if v_key.organization_id is not null and v_key.organization_id is distinct from p_organization then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from ia_connect.organizations o where o.id = p_organization) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
    select c.id, c.contact_id, ct.full_name, c.channel, c.status, c.last_message_at, c.unread_count, c.created_at
      from ia_connect.conversations c
      join ia_connect.contacts ct on ct.id = c.contact_id
     where c.organization_id = p_organization
       and (p_before is null or c.created_at < p_before)
     order by c.created_at desc
     limit p_limit;
end $$;

create or replace function ia_connect.api_messages(
  p_hash text,
  p_organization uuid,
  p_conversation uuid,
  p_limit integer,
  p_before timestamptz
) returns table (
  id uuid,
  direction text,
  channel text,
  content text,
  delivery_status text,
  external_id text,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_key ia_connect.api_keys;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  v_key := ia_connect.api_load_key(p_hash);
  if v_key.organization_id is not null and v_key.organization_id is distinct from p_organization then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from ia_connect.conversations c
     where c.id = p_conversation and c.organization_id = p_organization
  ) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.direction, m.channel, m.content, m.delivery_status, m.external_id, m.created_at
      from ia_connect.messages m
     where m.conversation_id = p_conversation
       and m.organization_id = p_organization
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc
     limit p_limit;
end $$;

revoke execute on function ia_connect.api_load_key(text) from public, anon, authenticated;
revoke execute on function ia_connect.api_organizations(text) from public, anon, authenticated;
revoke execute on function ia_connect.api_conversations(text, uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function ia_connect.api_messages(text, uuid, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function ia_connect.api_load_key(text) to service_role;
grant execute on function ia_connect.api_organizations(text) to service_role;
grant execute on function ia_connect.api_conversations(text, uuid, integer, timestamptz) to service_role;
grant execute on function ia_connect.api_messages(text, uuid, uuid, integer, timestamptz) to service_role;
