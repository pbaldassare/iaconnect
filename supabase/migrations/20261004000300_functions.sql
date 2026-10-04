-- IA Connect: defaults for new organizations, quotas, invitations, secrets, GDPR.

-- ── Defaults for a new organization ────────────────────────────────────

create or replace function ia_connect.init_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ia_connect.org_settings (organization_id) values (new.id);
  insert into ia_connect.deal_stages (organization_id, key, name, position, kind) values
    (new.id, 'new', 'Nuova richiesta', 0, 'open'),
    (new.id, 'quote_sent', 'Proposta inviata', 1, 'open'),
    (new.id, 'negotiation', 'In trattativa', 2, 'open'),
    (new.id, 'won', 'Chiusa', 3, 'won'),
    (new.id, 'lost', 'Persa', 4, 'lost');
  return new;
end $$;
create trigger init_organization after insert on ia_connect.organizations
  for each row execute function ia_connect.init_organization();

-- ── Quotas ─────────────────────────────────────────────────────────────

create or replace function ia_connect.usage_period() returns date
language sql stable as $$ select date_trunc('month', now())::date $$;

-- Atomically checks the plan limit and consumes `p_amount`. Returns false,
-- consuming nothing, when the limit would be exceeded. A limit of -1 means unlimited.
create or replace function ia_connect.consume_quota(p_org uuid, p_metric text, p_amount integer default 1)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_limit bigint;
  v_value bigint;
  v_key text := case p_metric
    when 'messages' then 'messages_per_month'
    when 'ai_credits' then 'ai_credits_per_month'
    when 'scrape_runs' then 'scrape_runs_per_month'
    else null end;
begin
  insert into ia_connect.usage_counters (organization_id, period, metric, value)
  values (p_org, ia_connect.usage_period(), p_metric, 0)
  on conflict (organization_id, period, metric) do nothing;

  select value into v_value from ia_connect.usage_counters
  where organization_id = p_org and period = ia_connect.usage_period() and metric = p_metric
  for update;

  if v_key is not null then
    select (p.limits ->> v_key)::bigint into v_limit
    from ia_connect.organizations o join ia_connect.plans p on p.id = o.plan_id
    where o.id = p_org;
    if v_limit is not null and v_limit >= 0 and v_value + p_amount > v_limit then
      return false;
    end if;
  end if;

  update ia_connect.usage_counters set value = value + p_amount
  where organization_id = p_org and period = ia_connect.usage_period() and metric = p_metric;
  return true;
end $$;

-- Adds usage without a limit check (e.g. the real AI cost once a call has finished).
create or replace function ia_connect.add_usage(p_org uuid, p_metric text, p_amount integer)
returns void
language sql security definer set search_path = '' as $$
  insert into ia_connect.usage_counters (organization_id, period, metric, value)
  values (p_org, ia_connect.usage_period(), p_metric, p_amount)
  on conflict (organization_id, period, metric)
  do update set value = ia_connect.usage_counters.value + excluded.value;
$$;

-- Remaining quota for the current month; null = unlimited.
create or replace function ia_connect.quota_left(p_org uuid, p_metric text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case
    when not ia_connect.has_org_access(p_org) and auth.uid() is not null then null
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

revoke execute on function ia_connect.consume_quota(uuid, text, integer) from public, authenticated;
revoke execute on function ia_connect.add_usage(uuid, text, integer) from public, authenticated;
grant execute on function ia_connect.consume_quota(uuid, text, integer) to service_role;
grant execute on function ia_connect.add_usage(uuid, text, integer) to service_role;

-- ── Invitations ────────────────────────────────────────────────────────

-- Turns the pending invitations for the signed-in user's email into memberships.
create or replace function ia_connect.accept_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_count integer := 0;
  inv record;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
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
grant execute on function ia_connect.accept_invitations() to authenticated;

-- ── Secrets (Supabase Vault) ───────────────────────────────────────────

create or replace function ia_connect.store_connection_secret(p_connection uuid, p_secret jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_existing uuid;
begin
  select organization_id into v_org from ia_connect.connections where id = p_connection;
  if v_org is null then raise exception 'connection % not found', p_connection; end if;
  select vault_secret_id into v_existing from ia_connect.connection_secrets where connection_id = p_connection;
  if v_existing is null then
    insert into ia_connect.connection_secrets (organization_id, connection_id, vault_secret_id)
    values (v_org, p_connection, vault.create_secret(p_secret::text, 'ia_connect_connection_' || p_connection::text));
  else
    perform vault.update_secret(v_existing, p_secret::text);
    update ia_connect.connection_secrets set updated_at = now() where connection_id = p_connection;
  end if;
end $$;

create or replace function ia_connect.read_connection_secret(p_connection uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_secret jsonb;
begin
  -- plpgsql so the Vault view is resolved at call time
  select d.decrypted_secret::jsonb into v_secret
  from ia_connect.connection_secrets s
  join vault.decrypted_secrets d on d.id = s.vault_secret_id
  where s.connection_id = p_connection;
  return v_secret;
end $$;

revoke execute on function ia_connect.store_connection_secret(uuid, jsonb) from public, authenticated;
revoke execute on function ia_connect.read_connection_secret(uuid) from public, authenticated;
grant execute on function ia_connect.store_connection_secret(uuid, jsonb) to service_role;
grant execute on function ia_connect.read_connection_secret(uuid) to service_role;

-- ── GDPR: export and deletion ──────────────────────────────────────────

create or replace function ia_connect.export_contact(p_contact uuid) returns jsonb
language sql stable set search_path = '' as $$
  -- SECURITY INVOKER: RLS decides what the caller can see.
  select jsonb_build_object(
    'contact', to_jsonb(c),
    'conversations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from ia_connect.conversations x where x.contact_id = c.id),
    'messages', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]')
                 from ia_connect.messages m join ia_connect.conversations x on x.id = m.conversation_id
                 where x.contact_id = c.id),
    'deals', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from ia_connect.deals d where d.contact_id = c.id),
    'appointments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from ia_connect.appointments a where a.contact_id = c.id)
  )
  from ia_connect.contacts c where c.id = p_contact;
$$;

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
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from ia_connect.%I x where x.organization_id = $1', t)
      into v_rows using p_org;
    v_out := v_out || jsonb_build_object(t, v_rows);
  end loop;
  return v_out;
end $$;

-- Deletes an organization and everything it owns, including its Vault secrets.
create or replace function ia_connect.delete_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if auth.uid() is not null and not ia_connect.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for s in select vault_secret_id from ia_connect.connection_secrets where organization_id = p_org loop
    begin
      delete from vault.secrets where id = s.vault_secret_id;
    exception when undefined_table or invalid_schema_name then null;
    end;
  end loop;
  delete from ia_connect.organizations where id = p_org;
end $$;
grant execute on function ia_connect.export_contact(uuid) to authenticated;
grant execute on function ia_connect.export_organization(uuid) to authenticated;
grant execute on function ia_connect.delete_organization(uuid) to authenticated, service_role;

-- ── Seed: default reseller, plans, connector catalog ───────────────────

insert into ia_connect.resellers (name, slug) values ('IA Connect', 'default');

insert into ia_connect.plans (key, name, limits, price_monthly_cents) values
  ('starter', 'Starter', '{"active_flows": 3, "messages_per_month": 1000, "scrape_runs_per_month": 0, "ai_credits_per_month": 500}', 9900),
  ('pro', 'Pro', '{"active_flows": 10, "messages_per_month": 5000, "scrape_runs_per_month": 1500, "ai_credits_per_month": 3000}', 24900),
  ('business', 'Business', '{"active_flows": 50, "messages_per_month": 25000, "scrape_runs_per_month": 10000, "ai_credits_per_month": 15000}', 59900);

insert into ia_connect.connector_types (key, category, name, description, connect_mode) values
  ('gmail', 'mail', 'Gmail', 'Legge le mail in arrivo e invia dal tuo indirizzo Gmail.', 'oauth'),
  ('microsoft365', 'mail', 'Microsoft 365', 'Posta di Outlook ed Exchange Online.', 'oauth'),
  ('imap_smtp', 'mail', 'Altra casella (IMAP/SMTP)', 'Qualsiasi casella con accesso IMAP e SMTP.', 'credentials'),
  ('whatsapp_meta', 'whatsapp', 'WhatsApp Business (Meta)', 'API ufficiale di Meta con modelli approvati.', 'api_key'),
  ('whatsapp_wawebapi', 'whatsapp', 'WhatsApp via QR (waWebApi)', 'Collega il numero inquadrando un codice QR.', 'qr'),
  ('crm_rest', 'crm', 'Gestionale (API)', 'Legge e scrive sul gestionale tramite la sua API.', 'api_key'),
  ('webhook_inbound', 'crm', 'Webhook in ingresso', 'Riceve eventi dal tuo sito o gestionale.', 'webhook'),
  ('google_calendar', 'calendar', 'Google Calendar', 'Legge gli orari liberi e fissa appuntamenti.', 'oauth'),
  ('meta_social', 'social', 'Facebook e Instagram', 'Contatti dai moduli, messaggi, commenti e post.', 'oauth'),
  ('ghl_social', 'social', 'GoHighLevel', 'Usa un sotto-account GoHighLevel come ponte verso i social.', 'api_key'),
  ('sms_twilio', 'sms', 'SMS (Twilio)', 'Invio e ricezione di SMS.', 'api_key'),
  ('scraper_site', 'scraper', 'Sito o portale', 'Legge le novità da un sito a orari fissi.', 'credentials'),
  ('payment_stripe', 'payment', 'Pagamenti (Stripe)', 'Crea link di pagamento.', 'api_key'),
  ('signature_link', 'signature', 'Firma tramite link', 'Invia un documento da firmare tramite link.', 'api_key');
