-- Fudge backend: spreadsheet-compatible rows behind a private Edge Function.
-- Browser clients never receive database or service-role access.

create table public.fudge_workspaces (
  id uuid primary key,
  name text not null,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fudge_rows (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  tab text not null check (tab in ('Structure', 'Reviews', 'Search Progress', 'Businesses', 'Cities', 'Services', 'Names')),
  cells jsonb not null default '[]'::jsonb check (jsonb_typeof(cells) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fudge_rows_workspace_tab_order_idx
  on public.fudge_rows (workspace_id, tab, id);

create unique index fudge_reviews_review_id_uidx
  on public.fudge_rows (workspace_id, (cells ->> 0))
  where tab = 'Reviews' and coalesce(cells ->> 0, '') <> '';

create unique index fudge_reviews_fingerprint_uidx
  on public.fudge_rows (workspace_id, (cells ->> 1))
  where tab = 'Reviews' and coalesce(cells ->> 1, '') <> '';

create unique index fudge_progress_search_key_uidx
  on public.fudge_rows (workspace_id, (cells ->> 0))
  where tab = 'Search Progress' and coalesce(cells ->> 0, '') <> '';

create unique index fudge_business_visit_uidx
  on public.fudge_rows (
    workspace_id,
    (cells ->> 0),
    (cells ->> 1),
    (cells ->> 2)
  )
  where tab = 'Businesses' and coalesce(cells ->> 0, '') <> '';

create table public.fudge_automation (
  workspace_id uuid primary key references public.fudge_workspaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.fudge_workspaces enable row level security;
alter table public.fudge_rows enable row level security;
alter table public.fudge_automation enable row level security;

revoke all on table public.fudge_workspaces from public, anon, authenticated;
revoke all on table public.fudge_rows from public, anon, authenticated;
revoke all on table public.fudge_automation from public, anon, authenticated;
grant select, insert, update, delete on table public.fudge_workspaces to service_role;
grant select, insert, update, delete on table public.fudge_rows to service_role;
grant select, insert, update, delete on table public.fudge_automation to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into public.fudge_workspaces (id, name, secret_hash)
values (
  'c0dd5276-09eb-402b-8a67-b2192d39988e',
  'Fudge',
  'b2a000cb4529eb7e8b3f64e03a4b9eb101f42d0dd34fc10e9da6ce7ce2c19766'
);

insert into public.fudge_automation (workspace_id, state)
values (
  'c0dd5276-09eb-402b-8a67-b2192d39988e',
  jsonb_build_object(
    'queueTrigger', true,
    'rephraseTrigger', false,
    'editTrigger', false,
    'writerConfigured', false,
    'model', 'gpt-5.6-luna',
    'lastRephrased', 0,
    'lastRunAt', null,
    'lastError', null
  )
);

insert into public.fudge_rows (workspace_id, tab, cells)
select
  'c0dd5276-09eb-402b-8a67-b2192d39988e',
  'Services',
  jsonb_build_array(service, 'Active', '', '')
from unnest(array[
  'Drywall', 'Painting', 'Flooring', 'Garage doors', 'Installation',
  'Plumbing', 'Electrical', 'Holiday lighting', 'Junk removal', 'Roofing',
  'Carpentry', 'Remodeling', 'HVAC', 'Exterior', 'Appliance repair',
  'Specialty cleaning', 'Moving', 'General repairs'
]) with ordinality as seeded(service, ordering)
order by ordering;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fudge-review-images',
  'fudge-review-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
