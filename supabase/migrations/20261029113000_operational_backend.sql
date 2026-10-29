-- Fudge operational backend. The original fudge_rows tables remain as an import
-- and backwards-compatibility layer; these normalized tables are authoritative.

create extension if not exists pgcrypto;

create or replace function public.fudge_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.fudge_workspace_members (
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  active boolean not null default true,
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  target_count integer not null default 1 check (target_count >= 0),
  backup_count integer not null default 2 check (backup_count >= 0),
  location_filters text[] not null default '{}',
  requires_customer_photos boolean not null default false,
  eligibility_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(eligibility_rules) = 'object'),
  priority integer not null default 100,
  collected_count integer not null default 0,
  assigned_count integer not null default 0,
  rejected_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.search_keywords (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  keyword text not null,
  priority integer not null default 100,
  active boolean not null default true,
  status text not null default 'ready' check (status in ('ready', 'searching', 'exhausted', 'paused')),
  attempt_count integer not null default 0,
  last_searched_at timestamptz,
  exhausted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, keyword)
);

create table public.extensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  installation_id text not null,
  name text not null default 'Fudge Chrome Extension',
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'offline' check (status in ('online', 'offline', 'paused', 'disabled')),
  version text,
  capabilities jsonb not null default '{}'::jsonb,
  active_job_id uuid,
  last_heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, installation_id)
);

create table public.search_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  keyword_id uuid not null references public.search_keywords(id) on delete cascade,
  extension_id uuid references public.extensions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'running', 'completed', 'failed', 'cancelled')),
  priority integer not null default 100,
  query text not null,
  city text not null default '',
  review_mode text not null default 'With Picture',
  target_count integer not null default 1 check (target_count > 0),
  lease_token uuid,
  leased_until timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null,
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

alter table public.extensions
  add constraint extensions_active_job_id_fkey
  foreign key (active_job_id) references public.search_jobs(id) on delete set null;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  source_review_id text,
  fingerprint text,
  fallback_identity text not null,
  service_id uuid references public.services(id) on delete set null,
  source_job_id uuid references public.search_jobs(id) on delete set null,
  business_name text not null default '',
  place_id text not null default '',
  city text not null default '',
  rating smallint not null default 5 check (rating between 1 and 5),
  review_text text not null,
  reviewer_name text not null default '',
  review_type text not null default 'With Picture',
  original_photo_urls text[] not null default '{}',
  drive_photo_urls text[] not null default '{}',
  source_url text,
  collected_at timestamptz not null default now(),
  status text not null default 'available' check (status in ('available', 'assigned', 'rejected', 'archived')),
  rejection_reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index reviews_source_id_uidx on public.reviews (workspace_id, source_review_id)
  where source_review_id is not null and source_review_id <> '';
create unique index reviews_fingerprint_uidx on public.reviews (workspace_id, fingerprint)
  where fingerprint is not null and fingerprint <> '';
create unique index reviews_fallback_identity_uidx on public.reviews (workspace_id, fallback_identity);

create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete restrict,
  status text not null default 'assigned' check (status in ('assigned', 'accepted', 'rejected', 'released')),
  is_backup boolean not null default false,
  rejection_reason text,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, review_id)
);
create unique index review_one_active_assignment_uidx on public.review_assignments (review_id)
  where status in ('assigned', 'accepted');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  place_id text not null,
  service_id uuid references public.services(id) on delete set null,
  city text not null default '',
  name text not null default '',
  eligible_reviews integer not null default 0,
  scanned_at timestamptz not null default now(),
  scan_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, place_id, service_id, city)
);

create table public.search_history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  job_id uuid references public.search_jobs(id) on delete set null,
  extension_id uuid references public.extensions(id) on delete set null,
  keyword_id uuid references public.search_keywords(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'extension', 'system')),
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.api_idempotency (
  workspace_id uuid not null references public.fudge_workspaces(id) on delete cascade,
  extension_id uuid references public.extensions(id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index requirements_queue_idx on public.requirements (workspace_id, status, priority, updated_at);
create index search_keywords_queue_idx on public.search_keywords (workspace_id, status, active, priority);
create index search_jobs_claim_idx on public.search_jobs (workspace_id, status, priority, created_at);
create index search_jobs_lease_idx on public.search_jobs (workspace_id, leased_until) where status in ('leased', 'running');
create index reviews_inventory_idx on public.reviews (workspace_id, status, service_id, city, collected_at desc);
create index assignments_requirement_idx on public.review_assignments (workspace_id, requirement_id, status);
create index extensions_presence_idx on public.extensions (workspace_id, last_heartbeat_at desc);
create index history_job_idx on public.search_history (workspace_id, job_id, created_at desc);
create index activity_recent_idx on public.activity_logs (workspace_id, created_at desc);
create index idempotency_created_idx on public.api_idempotency (workspace_id, created_at);

create or replace function public.fudge_has_workspace_role(target_workspace uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.fudge_workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;
revoke all on function public.fudge_has_workspace_role(uuid, text[]) from public;
grant execute on function public.fudge_has_workspace_role(uuid, text[]) to authenticated, service_role;

create or replace function public.claim_fudge_search_job(target_workspace uuid, target_extension uuid, lease_seconds integer default 180)
returns setof public.search_jobs
language plpgsql security definer set search_path = public as $$
declare chosen public.search_jobs;
begin
  update public.search_jobs
     set status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
         extension_id = null,
         lease_token = null,
         leased_until = null,
         error = case when attempt_count >= max_attempts then 'Lease expired too many times.' else error end,
         updated_at = now()
   where workspace_id = target_workspace
     and status in ('leased', 'running')
     and leased_until < now();

  select * into chosen
    from public.search_jobs
   where workspace_id = target_workspace and status = 'pending'
   order by priority asc, created_at asc
   for update skip locked
   limit 1;
  if chosen.id is null then return; end if;

  update public.search_jobs
     set status = 'leased', extension_id = target_extension,
         lease_token = gen_random_uuid(), leased_until = now() + make_interval(secs => greatest(30, least(900, lease_seconds))),
         heartbeat_at = now(), attempt_count = attempt_count + 1, updated_at = now()
   where id = chosen.id
   returning * into chosen;
  update public.extensions set active_job_id = chosen.id, status = 'online', last_heartbeat_at = now(), updated_at = now()
   where id = target_extension and workspace_id = target_workspace;
  return next chosen;
end;
$$;
revoke all on function public.claim_fudge_search_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_fudge_search_job(uuid, uuid, integer) to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['fudge_workspace_members','services','requirements','search_keywords','extensions','search_jobs','reviews','review_assignments','businesses','search_history','activity_logs','api_idempotency']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;

-- Supabase Auth users can only see their own workspace. Operators may write normal
-- operational data; owners/admins may also manage services, requirements and members.
create policy workspace_members_read on public.fudge_workspace_members for select to authenticated
  using (public.fudge_has_workspace_role(workspace_id, array['owner','admin','operator','viewer']));
create policy workspace_members_admin on public.fudge_workspace_members for all to authenticated
  using (public.fudge_has_workspace_role(workspace_id, array['owner','admin']))
  with check (public.fudge_has_workspace_role(workspace_id, array['owner','admin']));

do $$
declare table_name text;
begin
  foreach table_name in array array['services','requirements','search_keywords']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'',''viewer'']))', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin''])) with check (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_admin', table_name);
  end loop;
  foreach table_name in array array['extensions','search_jobs','reviews','review_assignments','businesses','search_history','activity_logs']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'',''viewer'']))', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator''])) with check (public.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'']))', table_name || '_operate', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['services','requirements','search_keywords','extensions','search_jobs','reviews','review_assignments','businesses']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.fudge_set_updated_at()', table_name || '_updated_at', table_name);
  end loop;
end $$;

-- Seed the normalized service catalogue from the existing compatibility rows.
insert into public.services (workspace_id, name, slug, active, rules)
select r.workspace_id,
       r.cells ->> 0,
       trim(both '-' from regexp_replace(lower(r.cells ->> 0), '[^a-z0-9]+', '-', 'g')),
       lower(coalesce(r.cells ->> 1, 'active')) not in ('inactive', 'paused', 'disabled'),
       jsonb_build_object('legacyCells', r.cells)
  from public.fudge_rows r
 where r.tab = 'Services' and coalesce(r.cells ->> 0, '') <> ''
on conflict (workspace_id, slug) do nothing;

-- Publish durable operational state for authenticated dashboard clients.
do $$
declare table_name text;
begin
  foreach table_name in array array['services','requirements','search_keywords','extensions','search_jobs','reviews','review_assignments','activity_logs']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
