
create table job_executions (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  entity_id uuid,
  idempotency_key text not null,
  attempt integer not null default 1,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  unique(job_type, idempotency_key)
);
create index idx_job_exec_entity on job_executions(entity_id);

