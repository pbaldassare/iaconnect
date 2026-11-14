-- Structured business facts and Q&A training per organization, for WhatsApp / ai.reply context.

alter table ia_connect.org_settings
  add column if not exists business_profile jsonb not null default '{}',
  add column if not exists ai_training jsonb not null default '{"entries":[]}';

comment on column ia_connect.org_settings.business_profile is
  'Sedi, orari, servizi: fatti strutturati letti dall''IA in ogni risposta.';
comment on column ia_connect.org_settings.ai_training is
  'Domande e risposte addestrate dal cliente (knowledge base), unite alle istruzioni libere.';