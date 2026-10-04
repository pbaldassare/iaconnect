-- IA Connect: tables. Everything lives in the `ia_connect` schema.
-- Customer tables carry `organization_id`; RLS is enabled in the next migration.

create or replace function ia_connect.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── Structure ──────────────────────────────────────────────────────────

create table ia_connect.resellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  brand jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  -- { active_flows, messages_per_month, scrape_runs_per_month, ai_credits_per_month }
  limits jsonb not null,
  price_monthly_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.organizations (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references ia_connect.resellers (id),
  name text not null,
  sector text not null default 'other',
  plan_id uuid not null references ia_connect.plans (id),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.organizations (reseller_id);

create table ia_connect.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references ia_connect.organizations (id) on delete cascade,
  reseller_id uuid references ia_connect.resellers (id) on delete cascade,
  role text not null check (role in ('platform_admin', 'reseller_admin', 'org_owner', 'org_member')),
  -- org_member permissions that can be switched on per user
  permissions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_scope check (
    (role = 'platform_admin' and organization_id is null and reseller_id is null)
    or (role = 'reseller_admin' and organization_id is null and reseller_id is not null)
    or (role in ('org_owner', 'org_member') and organization_id is not null and reseller_id is null)
  )
);
create unique index memberships_unique on ia_connect.memberships
  (user_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'), coalesce(reseller_id, '00000000-0000-0000-0000-000000000000'));
create index on ia_connect.memberships (organization_id);

create table ia_connect.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('org_owner', 'org_member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table ia_connect.org_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references ia_connect.organizations (id) on delete cascade,
  language text not null default 'it',
  ai_tone text,
  ai_instructions text,
  -- sent when a request is outside the scope of ai.reply
  out_of_scope_reply text not null default 'Su questo non posso aiutarla. La metto in contatto con un nostro operatore.',
  -- appended to the first automatic message so the recipient knows it is automated
  ai_disclosure text not null default 'Questo è un messaggio automatico.',
  brand jsonb not null default '{}',
  deal_custom_fields jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.org_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, feature_key)
);

create table ia_connect.usage_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  period date not null,
  metric text not null check (metric in ('messages', 'ai_credits', 'flow_runs', 'scrape_runs')),
  value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period, metric)
);

-- ── Connections ────────────────────────────────────────────────────────

create table ia_connect.connector_types (
  key text primary key,
  category text not null check (category in ('mail', 'whatsapp', 'crm', 'social', 'scraper', 'sms', 'calendar', 'payment', 'signature')),
  name text not null,
  description text not null default '',
  connect_mode text not null check (connect_mode in ('oauth', 'api_key', 'credentials', 'qr', 'webhook')),
  config_schema jsonb not null default '{}',
  -- null = every plan
  allowed_plans text[],
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  connector_type text not null references ia_connect.connector_types (key),
  name text not null,
  status text not null default 'active' check (status in ('active', 'expired', 'error', 'disconnected')),
  config jsonb not null default '{}',
  external_account_id text,
  last_checked_at timestamptz,
  last_error text,
  -- random token that identifies this connection in inbound webhook URLs
  webhook_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.connections (organization_id);
create index on ia_connect.connections (connector_type, external_account_id);

create table ia_connect.connection_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  connection_id uuid not null unique references ia_connect.connections (id) on delete cascade,
  -- id of the encrypted secret in Supabase Vault (vault.secrets)
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Events and flows ───────────────────────────────────────────────────

create table ia_connect.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  type text not null,
  connection_id uuid references ia_connect.connections (id) on delete set null,
  payload jsonb not null default '{}',
  contact_hint jsonb,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  locked_until timestamptz,
  available_at timestamptz not null default now(),
  error text,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index events_queue on ia_connect.events (available_at) where status in ('pending', 'processing');
create index on ia_connect.events (organization_id, created_at desc);

create table ia_connect.flow_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  sector text not null,
  name text not null,
  description text not null default '',
  definition jsonb not null,
  -- message templates and deal stages the flow expects, created on install
  requirements jsonb not null default '{}',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  active_version_id uuid,
  -- copied from the active version so event matching does not parse JSON
  trigger_event text,
  template_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.flows (organization_id, status, trigger_event);

create table ia_connect.flow_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  flow_id uuid not null references ia_connect.flows (id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  author_type text not null check (author_type in ('user', 'ai', 'system')),
  author_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_id, version)
);
alter table ia_connect.flows
  add constraint flows_active_version_fk foreign key (active_version_id)
  references ia_connect.flow_versions (id) on delete set null;

create table ia_connect.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  full_name text not null default '',
  phones text[] not null default '{}',
  emails text[] not null default '{}',
  -- { whatsapp: { granted, at, source }, mail: {...}, sms: {...}, social: {...} }
  consents jsonb not null default '{}',
  custom_fields jsonb not null default '{}',
  external_ids jsonb not null default '{}',
  -- what the platform remembers about the contact, shown in the inbox and given to ai.reply
  memory text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.contacts using gin (phones);
create index on ia_connect.contacts using gin (emails);
create index on ia_connect.contacts (organization_id, created_at desc);

create table ia_connect.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  contact_id uuid not null references ia_connect.contacts (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'mail', 'sms', 'social')),
  connection_id uuid references ia_connect.connections (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  assignee_type text not null default 'automation' check (assignee_type in ('automation', 'user')),
  assignee_user_id uuid,
  external_thread_id text,
  -- WhatsApp: free-form messages are allowed until this time
  window_expires_at timestamptz,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.conversations (organization_id, last_message_at desc);
create index on ia_connect.conversations (contact_id, channel);

create table ia_connect.deal_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  key text not null,
  name text not null,
  position integer not null default 0,
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table ia_connect.flow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  flow_id uuid not null references ia_connect.flows (id) on delete cascade,
  flow_version_id uuid not null references ia_connect.flow_versions (id) on delete cascade,
  event_id uuid references ia_connect.events (id) on delete set null,
  mode text not null default 'live' check (mode in ('live', 'simulation')),
  status text not null default 'running' check (status in ('running', 'waiting', 'completed', 'failed', 'cancelled')),
  current_step_id text,
  -- { event, steps: { <id>: { output } }, reply }
  context jsonb not null default '{}',
  contact_id uuid references ia_connect.contacts (id) on delete set null,
  conversation_id uuid references ia_connect.conversations (id) on delete set null,
  deal_id uuid,
  waiting_for text check (waiting_for in ('reply', 'timer', 'approval')),
  wait_until timestamptz,
  attempts integer not null default 0,
  locked_until timestamptz,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one run per event and flow version: makes event redelivery harmless
  unique (flow_version_id, event_id, mode)
);
create index on ia_connect.flow_runs (organization_id, started_at desc);
create index flow_runs_waiting_reply on ia_connect.flow_runs (conversation_id) where status = 'waiting' and waiting_for = 'reply';

create table ia_connect.flow_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  flow_run_id uuid not null references ia_connect.flow_runs (id) on delete cascade,
  step_id text not null,
  -- "<step_id>" or "<step_id>#<n>" for blocks that run more than once (ai.reply turns)
  idempotency_key text not null,
  block text not null,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  outlet text,
  status text not null check (status in ('running', 'succeeded', 'failed', 'simulated', 'waiting')),
  error text,
  ai_cost_micros bigint not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_run_id, idempotency_key)
);

create table ia_connect.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references ia_connect.organizations (id) on delete cascade,
  -- resume_run | wait_timeout | scrape | verify_connection | poll_connection | report
  kind text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text,
  flow_run_id uuid references ia_connect.flow_runs (id) on delete cascade,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_jobs_due on ia_connect.scheduled_jobs (run_at) where status in ('pending', 'running');

-- ── Scraping ───────────────────────────────────────────────────────────

create table ia_connect.scrape_recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  name text not null,
  target_url text not null,
  goal text not null default '',
  connection_id uuid references ia_connect.connections (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'broken')),
  active_version_id uuid,
  interval_minutes integer not null default 60 check (interval_minutes >= 15),
  repair_attempts integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.scrape_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  recipe_id uuid not null references ia_connect.scrape_recipes (id) on delete cascade,
  version integer not null,
  -- validated by ScrapeRecipeSchema in packages/core
  recipe jsonb not null,
  generated_by text not null check (generated_by in ('ai', 'manual')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, version)
);
alter table ia_connect.scrape_recipes
  add constraint scrape_recipes_active_version_fk foreign key (active_version_id)
  references ia_connect.scrape_recipe_versions (id) on delete set null;

create table ia_connect.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  recipe_id uuid not null references ia_connect.scrape_recipes (id) on delete cascade,
  recipe_version_id uuid references ia_connect.scrape_recipe_versions (id) on delete set null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_extracted integer not null default 0,
  new_rows integer not null default 0,
  error text,
  needed_repair boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── People ─────────────────────────────────────────────────────────────

create table ia_connect.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'mail', 'sms', 'social')),
  name text not null,
  language text not null default 'it',
  subject text,
  -- body with {{1}}, {{2}}… placeholders
  body text not null,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'pending', 'approved', 'rejected')),
  external_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, name)
);

create table ia_connect.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  conversation_id uuid not null references ia_connect.conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  channel text not null check (channel in ('whatsapp', 'mail', 'sms', 'social')),
  content text not null default '',
  meta jsonb not null default '{}',
  template_id uuid references ia_connect.message_templates (id) on delete set null,
  ai_generated boolean not null default false,
  ai_model text,
  delivery_status text not null default 'sent' check (delivery_status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received', 'simulated')),
  external_id text,
  flow_run_id uuid references ia_connect.flow_runs (id) on delete set null,
  sent_by_user_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.messages (conversation_id, created_at);
create unique index messages_external on ia_connect.messages (organization_id, channel, external_id) where external_id is not null;

create table ia_connect.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  contact_id uuid not null references ia_connect.contacts (id) on delete cascade,
  title text not null,
  stage_id uuid not null references ia_connect.deal_stages (id),
  estimated_value_cents bigint,
  currency text not null default 'EUR',
  origin_flow_run_id uuid references ia_connect.flow_runs (id) on delete set null,
  next_action text,
  next_action_at timestamptz,
  assignee_user_id uuid,
  custom_fields jsonb not null default '{}',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.deals (organization_id, stage_id);
alter table ia_connect.flow_runs
  add constraint flow_runs_deal_fk foreign key (deal_id) references ia_connect.deals (id) on delete set null;

create table ia_connect.deal_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  deal_id uuid not null references ia_connect.deals (id) on delete cascade,
  type text not null,
  from_stage_id uuid,
  to_stage_id uuid,
  actor_type text not null check (actor_type in ('user', 'admin', 'automation')),
  actor_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  flow_run_id uuid not null references ia_connect.flow_runs (id) on delete cascade,
  step_id text not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_run_id, step_id)
);

create table ia_connect.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  contact_id uuid references ia_connect.contacts (id) on delete cascade,
  deal_id uuid references ia_connect.deals (id) on delete set null,
  connection_id uuid references ia_connect.connections (id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'done')),
  external_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  contact_id uuid references ia_connect.contacts (id) on delete cascade,
  deal_id uuid references ia_connect.deals (id) on delete set null,
  connection_id uuid references ia_connect.connections (id) on delete set null,
  amount_cents bigint not null,
  currency text not null default 'EUR',
  description text not null default '',
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'simulated')),
  external_id text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_connect.signature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  contact_id uuid references ia_connect.contacts (id) on delete cascade,
  deal_id uuid references ia_connect.deals (id) on delete set null,
  connection_id uuid references ia_connect.connections (id) on delete set null,
  title text not null,
  document_url text not null,
  status text not null default 'pending' check (status in ('pending', 'signed', 'cancelled', 'simulated')),
  external_id text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Control ────────────────────────────────────────────────────────────

create table ia_connect.support_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  admin_user_id uuid not null,
  reason text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No FK on organization_id: the log must survive the deletion of an organization.
create table ia_connect.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  actor_type text not null check (actor_type in ('user', 'admin', 'automation', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  data jsonb not null default '{}',
  is_support_access boolean not null default false,
  created_at timestamptz not null default now()
);
create index on ia_connect.audit_log (organization_id, created_at desc);

create table ia_connect.ai_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ia_connect.organizations (id) on delete cascade,
  -- flow_assistant | scrape_trace | scrape_repair | ai.extract | ai.classify | ai.reply | ai.summarize | report
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_micros bigint not null default 0,
  credits integer not null default 0,
  flow_run_id uuid references ia_connect.flow_runs (id) on delete set null,
  flow_run_step_id uuid references ia_connect.flow_run_steps (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ia_connect.ai_calls (organization_id, created_at desc);

-- updated_at triggers on every table that has the column
do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'ia_connect' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger set_updated_at before update on ia_connect.%I for each row execute function ia_connect.set_updated_at()',
      t.table_name);
  end loop;
end $$;
