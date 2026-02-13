
create table publish_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  domain_id uuid not null,
  draft_id uuid not null,
  target text not null,
  target_config jsonb not null,
  scheduled_for timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

