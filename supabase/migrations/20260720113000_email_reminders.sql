create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default false,
  paused_schedule_enabled boolean not null default false,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ledger_id text not null,
  subscription_id text not null,
  reminder_kind text not null check (reminder_kind in ('charge', 'trial')),
  scheduled_date date not null,
  lead_days integer not null check (lead_days in (0, 1, 3, 7, 14, 30)),
  subscription_name text not null check (char_length(subscription_name) between 1 and 100),
  amount numeric(14, 4) not null check (amount > 0 and amount <= 1000000000),
  currency text not null check (currency in ('USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF')),
  ledger_name text not null check (char_length(ledger_name) between 1 and 60),
  ledger_kind text not null check (ledger_kind in ('personal', 'household', 'team')),
  channel text not null default 'email' check (channel = 'email'),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 100),
  last_error_code text check (last_error_code is null or char_length(last_error_code) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, subscription_id)
    references public.subscriptions(ledger_id, id) on delete cascade,
  constraint notification_deliveries_dedupe
    unique (user_id, ledger_id, subscription_id, reminder_kind, scheduled_date, lead_days, channel),
  check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index notification_deliveries_claim_idx
on public.notification_deliveries (status, next_attempt_at, claimed_at)
where status in ('pending', 'sending', 'failed');

alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;

create policy notification_preferences_select_self
on public.notification_preferences for select to authenticated
using (user_id = (select auth.uid()));

create trigger notification_preferences_touch_updated_at
before update on public.notification_preferences
for each row execute function public.touch_updated_at();

create trigger notification_deliveries_touch_updated_at
before update on public.notification_deliveries
for each row execute function public.touch_updated_at();

revoke all on public.notification_preferences, public.notification_deliveries from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;

insert into public.notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.save_notification_preferences(
  requested_email_enabled boolean,
  requested_paused_schedule_enabled boolean,
  requested_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_timezone text := trim(requested_timezone);
  saved public.notification_preferences;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if requested_email_enabled is null or requested_paused_schedule_enabled is null then
    raise exception 'Notification settings are incomplete.';
  end if;
  if normalized_timezone is null
    or char_length(normalized_timezone) not between 1 and 100
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone) then
    raise exception 'Notification timezone is invalid.' using errcode = '22023';
  end if;
  if requested_email_enabled and not public.has_lifetime_pro() then
    raise exception 'Outflow Pro is required for email automation.' using errcode = '42501';
  end if;

  insert into public.notification_preferences (
    user_id, email_enabled, paused_schedule_enabled, timezone
  ) values (
    caller, requested_email_enabled, requested_paused_schedule_enabled, normalized_timezone
  )
  on conflict (user_id) do update set
    email_enabled = excluded.email_enabled,
    paused_schedule_enabled = excluded.paused_schedule_enabled,
    timezone = excluded.timezone
  returning * into saved;

  return jsonb_build_object(
    'emailEnabled', saved.email_enabled,
    'pausedScheduleEnabled', saved.paused_schedule_enabled,
    'timezone', saved.timezone,
    'updatedAt', saved.updated_at
  );
end;
$$;

create or replace function public.advance_notification_date(
  base_date date,
  billing_cycle text,
  not_before date
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate date := base_date;
  advances integer := 0;
begin
  if billing_cycle not in ('weekly', 'monthly', 'yearly') then
    raise exception 'Billing cycle is invalid.';
  end if;
  while candidate < not_before and advances < 50000 loop
    candidate := case billing_cycle
      when 'weekly' then candidate + 7
      when 'monthly' then (
        pg_catalog.date_trunc('month', candidate)::date
        + interval '1 month'
        + (extract(day from candidate)::integer - 1) * interval '1 day'
      )::date
      when 'yearly' then (
        pg_catalog.date_trunc('year', candidate)::date
        + interval '1 year'
        + (extract(doy from candidate)::integer - 1) * interval '1 day'
      )::date
    end;
    advances := advances + 1;
  end loop;
  if candidate < not_before then raise exception 'Billing date could not be advanced safely.'; end if;
  return candidate;
end;
$$;

create or replace function public.claim_due_email_notifications(
  requested_batch_size integer,
  worker_claim_token uuid
)
returns table (
  delivery_id uuid,
  recipient_email text,
  subscription_name text,
  amount numeric,
  currency text,
  billing_date date,
  ledger_name text,
  ledger_kind text,
  reminder_kind text,
  lead_days integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_batch_size is null or requested_batch_size not between 1 and 100 then
    raise exception 'Notification batch size must be between 1 and 100.';
  end if;
  if worker_claim_token is null then raise exception 'Worker claim token is required.'; end if;

  insert into public.notification_deliveries (
    user_id, ledger_id, subscription_id, reminder_kind, scheduled_date, lead_days,
    subscription_name, amount, currency, ledger_name, ledger_kind
  )
  select
    preferences.user_id,
    subscription.ledger_id,
    subscription.id,
    schedule.reminder_kind,
    schedule.scheduled_date,
    lead.lead_days,
    subscription.name,
    subscription.amount,
    subscription.currency,
    ledger.name,
    ledger.kind
  from public.notification_preferences as preferences
  join public.entitlements as entitlement
    on entitlement.user_id = preferences.user_id
    and entitlement.product = 'outflow_pro_lifetime'
    and entitlement.status = 'active'
  join public.ledger_members as membership on membership.user_id = preferences.user_id
  join public.subscriptions as subscription on subscription.ledger_id = membership.ledger_id
  join public.ledgers as ledger on ledger.id = subscription.ledger_id
  cross join lateral (
    select (pg_catalog.unnest(subscription.reminder_lead_days))::integer as lead_days
  ) as lead
  cross join lateral (
    values
      ('charge'::text, public.advance_notification_date(
        subscription.next_billing_date,
        subscription.cycle,
        (now() at time zone preferences.timezone)::date
      )),
      ('trial'::text, subscription.trial_end_date)
  ) as schedule(reminder_kind, scheduled_date)
  where preferences.email_enabled
    and schedule.scheduled_date is not null
    and (not subscription.paused or preferences.paused_schedule_enabled)
    and schedule.scheduled_date - (now() at time zone preferences.timezone)::date = lead.lead_days
    and exists (
      select 1 from auth.users
      where auth.users.id = preferences.user_id
        and auth.users.email is not null
        and char_length(auth.users.email) between 3 and 254
    )
  on conflict on constraint notification_deliveries_dedupe
  do nothing;

  return query
  with candidates as (
    select delivery.id
    from public.notification_deliveries as delivery
    join public.notification_preferences as preferences
      on preferences.user_id = delivery.user_id and preferences.email_enabled
    join public.entitlements as entitlement
      on entitlement.user_id = delivery.user_id
      and entitlement.product = 'outflow_pro_lifetime'
      and entitlement.status = 'active'
    join public.ledger_members as membership
      on membership.user_id = delivery.user_id and membership.ledger_id = delivery.ledger_id
    join public.subscriptions as subscription
      on subscription.ledger_id = delivery.ledger_id and subscription.id = delivery.subscription_id
    where delivery.attempt_count < 5
      and (not subscription.paused or preferences.paused_schedule_enabled)
      and (
        (delivery.status in ('pending', 'failed') and delivery.next_attempt_at <= now())
        or (delivery.status = 'sending' and delivery.claimed_at <= now() - interval '15 minutes')
      )
    order by delivery.scheduled_date, delivery.created_at, delivery.id
    limit requested_batch_size
    for update of delivery skip locked
  ), claimed as (
    update public.notification_deliveries as delivery
    set
      status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      claim_token = worker_claim_token,
      claimed_at = now(),
      last_error_code = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    account.email,
    claimed.subscription_name,
    claimed.amount,
    claimed.currency,
    claimed.scheduled_date,
    claimed.ledger_name,
    claimed.ledger_kind,
    claimed.reminder_kind,
    claimed.lead_days
  from claimed
  join auth.users as account on account.id = claimed.user_id
  where account.email is not null;
end;
$$;

create or replace function public.complete_email_notification(
  target_delivery_id uuid,
  worker_claim_token uuid,
  delivery_succeeded boolean,
  provider_identifier text default null,
  error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  bounded_provider_identifier text := nullif(left(trim(provider_identifier), 100), '');
  bounded_error_code text := nullif(left(trim(error_code), 80), '');
begin
  if target_delivery_id is null or worker_claim_token is null or delivery_succeeded is null then
    raise exception 'Notification completion details are incomplete.';
  end if;

  update public.notification_deliveries
  set
    status = case when delivery_succeeded then 'sent' else 'failed' end,
    sent_at = case when delivery_succeeded then now() else null end,
    provider_message_id = case when delivery_succeeded then bounded_provider_identifier else null end,
    last_error_code = case when delivery_succeeded then null else coalesce(bounded_error_code, 'delivery_failed') end,
    next_attempt_at = case
      when delivery_succeeded then now()
      when attempt_count >= 5 then now() + interval '100 years'
      else now() + pg_catalog.make_interval(secs => least(3600, 30 * (2 ^ greatest(attempt_count - 1, 0))::integer))
    end,
    claim_token = null,
    claimed_at = null
  where id = target_delivery_id
    and status = 'sending'
    and claim_token = worker_claim_token;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_notification_preferences(boolean, boolean, text) from public, anon;
revoke all on function public.advance_notification_date(date, text, date) from public, anon, authenticated;
revoke all on function public.claim_due_email_notifications(integer, uuid) from public, anon, authenticated;
revoke all on function public.complete_email_notification(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.save_notification_preferences(boolean, boolean, text) to authenticated;
grant execute on function public.claim_due_email_notifications(integer, uuid) to service_role;
grant execute on function public.complete_email_notification(uuid, uuid, boolean, text, text) to service_role;
