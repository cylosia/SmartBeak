BEGIN;

create table keywords (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,
  phrase text not null,
  normalized_phrase text not null,
  source text, -- ahrefs | semrush | paa | manual | sitemap
  intent text, -- informational | commercial | transactional | mixed
  created_at timestamptz not null default now()
);

create unique index keywords_domain_norm_idx
  on keywords (domain_id, normalized_phrase);

create index keywords_domain_idx
  on keywords (domain_id);

create table content_keywords (
  content_id uuid not null references keywords(id) on delete cascade, -- P1-12: FK constraint
  keyword_id uuid not null references keywords(id) on delete cascade, -- P1-12: FK constraint
  role text not null check (role in ('primary', 'secondary', 'supporting')), -- P1-12: check constraint
  created_at timestamptz not null default now(),
  primary key (content_id, keyword_id)
);

create index content_keywords_keyword_idx
  on content_keywords (keyword_id);

create table keyword_clusters (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,
  label text not null,
  intent text,
  method text, -- P0-04: Added method column (e.g. 'lexical', 'semantic')
  created_at timestamptz not null default now()
);

create index keyword_clusters_domain_idx
  on keyword_clusters (domain_id);

create table cluster_keywords (
  cluster_id uuid not null references keyword_clusters(id) on delete cascade, -- P1-12: FK constraint
  keyword_id uuid not null references keywords(id) on delete cascade, -- P1-12: FK constraint
  primary key (cluster_id, keyword_id)
);

-- P0-03: Create keyword_suggestions table for ingestion pipeline
create table keyword_suggestions (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,
  keyword text not null,
  source text not null,
  metrics jsonb,
  ingestion_job_id text,
  created_at timestamptz not null default now()
);

create index keyword_suggestions_domain_idx
  on keyword_suggestions (domain_id);

create index keyword_suggestions_job_idx
  on keyword_suggestions (ingestion_job_id);

COMMIT;
