-- Security and query-plan hardening after the operational schema was exercised.

alter function public.fudge_set_updated_at() set search_path = public;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.fudge_has_workspace_role(target_workspace uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.fudge_workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;
revoke all on function private.fudge_has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.fudge_has_workspace_role(uuid, text[]) to authenticated, service_role;

drop policy if exists workspace_members_read on public.fudge_workspace_members;
drop policy if exists workspace_members_admin on public.fudge_workspace_members;
create policy workspace_members_read on public.fudge_workspace_members for select to authenticated
  using (private.fudge_has_workspace_role(workspace_id, array['owner','admin','operator','viewer']));
create policy workspace_members_insert on public.fudge_workspace_members for insert to authenticated
  with check (private.fudge_has_workspace_role(workspace_id, array['owner','admin']));
create policy workspace_members_update on public.fudge_workspace_members for update to authenticated
  using (private.fudge_has_workspace_role(workspace_id, array['owner','admin']))
  with check (private.fudge_has_workspace_role(workspace_id, array['owner','admin']));
create policy workspace_members_delete on public.fudge_workspace_members for delete to authenticated
  using (private.fudge_has_workspace_role(workspace_id, array['owner','admin']));

do $$
declare table_name text;
begin
  foreach table_name in array array['services','requirements','search_keywords']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'',''viewer'']))', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_admin_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin''])) with check (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_admin_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_admin_delete', table_name);
  end loop;
  foreach table_name in array array['extensions','search_jobs','reviews','review_assignments','businesses','search_history','activity_logs']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_operate', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'',''viewer'']))', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'']))', table_name || '_operate_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator''])) with check (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'']))', table_name || '_operate_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (private.fudge_has_workspace_role(workspace_id, array[''owner'',''admin'',''operator'']))', table_name || '_operate_delete', table_name);
  end loop;
end $$;

drop function if exists public.fudge_has_workspace_role(uuid, text[]);

-- Explicit server-only policies document the Edge Function boundary and silence
-- false-positive "RLS with no policy" findings without granting browser access.
create policy fudge_workspaces_server_only on public.fudge_workspaces for all to anon, authenticated using (false) with check (false);
create policy fudge_rows_server_only on public.fudge_rows for all to anon, authenticated using (false) with check (false);
create policy fudge_automation_server_only on public.fudge_automation for all to anon, authenticated using (false) with check (false);
create policy api_idempotency_server_only on public.api_idempotency for all to anon, authenticated using (false) with check (false);

create index api_idempotency_extension_idx on public.api_idempotency (extension_id);
create index businesses_service_idx on public.businesses (service_id);
create index extensions_active_job_idx on public.extensions (active_job_id);
create index workspace_members_user_idx on public.fudge_workspace_members (user_id);
create index requirements_service_idx on public.requirements (service_id);
create index reviews_service_idx on public.reviews (service_id);
create index reviews_source_job_idx on public.reviews (source_job_id);
create index search_history_extension_idx on public.search_history (extension_id);
create index search_history_job_only_idx on public.search_history (job_id);
create index search_history_keyword_idx on public.search_history (keyword_id);
create index search_jobs_extension_idx on public.search_jobs (extension_id);
create index search_jobs_keyword_idx on public.search_jobs (keyword_id);
create index search_jobs_requirement_idx on public.search_jobs (requirement_id);
