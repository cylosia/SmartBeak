
create table publish_executions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null,
  attempt integer not null,
  status text not null,
  external_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint fk_pe_intent foreign key (intent_id) references publish_intents(id)
);
create index idx_publish_exec_intent on publish_executions(intent_id);

