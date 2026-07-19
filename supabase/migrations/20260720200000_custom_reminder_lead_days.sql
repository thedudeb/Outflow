create or replace function public.valid_reminder_lead_days(candidate integer[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    cardinality(candidate) <= 12
    and coalesce((
      select pg_catalog.bool_and(value between 0 and 365)
      from pg_catalog.unnest(candidate) as value
    ), true)
    and cardinality(candidate) = (
      select count(distinct value)
      from pg_catalog.unnest(candidate) as value
    )
$$;

alter table public.subscriptions
drop constraint if exists subscriptions_reminder_lead_days_check;

alter table public.subscriptions
add constraint subscriptions_reminder_lead_days_check
check (public.valid_reminder_lead_days(reminder_lead_days));

alter table public.notification_deliveries
drop constraint if exists notification_deliveries_lead_days_check;

alter table public.notification_deliveries
add constraint notification_deliveries_lead_days_check
check (lead_days between 0 and 365);

revoke all on function public.valid_reminder_lead_days(integer[]) from public, anon;
grant execute on function public.valid_reminder_lead_days(integer[]) to authenticated, service_role;
