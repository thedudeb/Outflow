create table public.app_service_status (
  id text primary key check (id = 'primary'),
  maintenance_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.app_service_status_events (
  id bigint generated always as identity primary key,
  maintenance_enabled boolean not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.app_service_status (id, maintenance_enabled)
values ('primary', false);

alter table public.app_service_status enable row level security;
alter table public.app_service_status_events enable row level security;

revoke all on table public.app_service_status, public.app_service_status_events from public, anon, authenticated, service_role;
revoke all on sequence public.app_service_status_events_id_seq from public, anon, authenticated, service_role;

create or replace function public.is_outflow_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'outflow_role', '') = 'admin';
$$;

create or replace function public.read_app_service_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'maintenanceEnabled', maintenance_enabled,
    'updatedAt', updated_at
  )
  from public.app_service_status
  where id = 'primary';
$$;

create or replace function public.set_app_maintenance_mode(requested_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  changed boolean := false;
begin
  if not public.is_outflow_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  update public.app_service_status
  set maintenance_enabled = requested_enabled,
      updated_at = now(),
      updated_by = caller
  where id = 'primary'
    and maintenance_enabled is distinct from requested_enabled;
  changed := found;

  if changed then
    insert into public.app_service_status_events (maintenance_enabled, changed_by)
    values (requested_enabled, caller);
  end if;

  return public.read_app_service_status();
end;
$$;

revoke all on function public.is_outflow_admin() from public, anon, authenticated, service_role;
revoke all on function public.read_app_service_status() from public, anon, authenticated, service_role;
revoke all on function public.set_app_maintenance_mode(boolean) from public, anon, authenticated, service_role;

grant execute on function public.read_app_service_status() to anon, authenticated;
grant execute on function public.set_app_maintenance_mode(boolean) to authenticated;
