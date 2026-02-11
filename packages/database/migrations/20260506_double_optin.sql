BEGIN;

alter table email_optin_forms
add column optin_policy text not null default 'single'; -- single | double

create table email_optin_confirmations (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null,
  token text not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

COMMIT;
