-- Phase 1 proposal: additive storage for CV pipeline runs, research cache,
-- editable style examples, and verified layout results.
-- Run manually in Supabase SQL editor. This file is not executed by the app.

create table if not exists public.cv_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  stage text not null,
  model text,
  input_hash text,
  output_json jsonb,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.cv_research_cache (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  role_family text not null,
  research_json jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (company_name, role_family)
);

create table if not exists public.cv_style_examples (
  id uuid primary key default gen_random_uuid(),
  example_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cv_layouts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  layout_params jsonb not null,
  page_count integer,
  last_page_fill_ratio numeric,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cv_runs enable row level security;
alter table public.cv_research_cache enable row level security;
alter table public.cv_style_examples enable row level security;
alter table public.cv_layouts enable row level security;

-- ROLLBACK:
-- drop table if exists public.cv_layouts;
-- drop table if exists public.cv_style_examples;
-- drop table if exists public.cv_research_cache;
-- drop table if exists public.cv_runs;
