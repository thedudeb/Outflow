alter table public.notification_preferences
add column email_suppressed_at timestamptz,
add column email_suppression_reason text
  check (email_suppression_reason is null or email_suppression_reason in ('bounced', 'complained', 'suppressed')),
add column email_suppression_event_at timestamptz,
add constraint notification_preferences_suppression_state check (
  (email_suppressed_at is null and email_suppression_reason is null)
  or (email_suppressed_at is not null and email_suppression_reason is not null)
);

alter table public.notification_deliveries
add column provider_status text
  check (provider_status is null or provider_status in (
    'accepted', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed'
  )),
add column provider_event_at timestamptz;

create unique index notification_deliveries_provider_message_idx
on public.notification_deliveries (provider_message_id)
where provider_message_id is not null;

create table public.notification_provider_events (
  event_id text primary key check (
    char_length(event_id) between 1 and 128 and event_id ~ '^[A-Za-z0-9_-]+$'
  ),
  delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  provider_message_id text not null check (
    char_length(provider_message_id) between 1 and 100 and provider_message_id ~ '^[A-Za-z0-9_-]+$'
  ),
  event_type text not null check (event_type in (
    'email.delivered', 'email.delivery_delayed', 'email.failed',
    'email.bounced', 'email.complained', 'email.suppressed'
  )),
  event_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (provider_message_id, event_type, event_created_at)
);

alter table public.notification_provider_events enable row level security;
revoke all on public.notification_provider_events from public, anon, authenticated;

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
  current_preferences public.notification_preferences;
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

  select * into current_preferences
  from public.notification_preferences
  where user_id = caller;
  if requested_email_enabled and current_preferences.email_suppressed_at is not null then
    raise exception 'Email reminders are suppressed after a provider delivery failure. Resume them explicitly.' using errcode = '42501';
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
    'emailSuppressedAt', saved.email_suppressed_at,
    'emailSuppressionReason', saved.email_suppression_reason,
    'updatedAt', saved.updated_at
  );
end;
$$;

create or replace function public.resume_email_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  saved public.notification_preferences;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if not public.has_lifetime_pro() then
    raise exception 'Outflow Pro is required for email automation.' using errcode = '42501';
  end if;

  update public.notification_preferences
  set
    email_enabled = true,
    email_suppressed_at = null,
    email_suppression_reason = null
  where user_id = caller
    and email_suppressed_at is not null
  returning * into saved;

  if saved.user_id is null then
    raise exception 'Email reminders are not suppressed.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'emailEnabled', saved.email_enabled,
    'pausedScheduleEnabled', saved.paused_schedule_enabled,
    'timezone', saved.timezone,
    'emailSuppressedAt', saved.email_suppressed_at,
    'emailSuppressionReason', saved.email_suppression_reason,
    'updatedAt', saved.updated_at
  );
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
  if delivery_succeeded and (
    bounded_provider_identifier is null or bounded_provider_identifier !~ '^[A-Za-z0-9_-]+$'
  ) then
    raise exception 'Successful notification completion requires a valid provider identifier.' using errcode = '22023';
  end if;

  update public.notification_deliveries
  set
    status = case when delivery_succeeded then 'sent' else 'failed' end,
    sent_at = case when delivery_succeeded then now() else null end,
    provider_message_id = case when delivery_succeeded then bounded_provider_identifier else null end,
    provider_status = case when delivery_succeeded then 'accepted' else null end,
    provider_event_at = null,
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

create or replace function public.record_email_provider_event(
  provider_event_id text,
  provider_event_type text,
  provider_identifier text,
  provider_event_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_event_id text := trim(provider_event_id);
  bounded_provider_identifier text := trim(provider_identifier);
  delivery public.notification_deliveries;
  inserted_event_id text;
  provider_state text;
  suppression_reason text;
begin
  if bounded_event_id is null or char_length(bounded_event_id) not between 1 and 128 or bounded_event_id !~ '^[A-Za-z0-9_-]+$'
    or bounded_provider_identifier is null or char_length(bounded_provider_identifier) not between 1 and 100 or bounded_provider_identifier !~ '^[A-Za-z0-9_-]+$'
    or provider_event_created_at is null
    or provider_event_type not in (
      'email.delivered', 'email.delivery_delayed', 'email.failed',
      'email.bounced', 'email.complained', 'email.suppressed'
    ) then
    raise exception 'Provider event is invalid.' using errcode = '22023';
  end if;

  select * into delivery
  from public.notification_deliveries
  where provider_message_id = bounded_provider_identifier
  for update;

  if delivery.id is null then
    return jsonb_build_object('result', 'unmatched');
  end if;

  insert into public.notification_provider_events (
    event_id, delivery_id, provider_message_id, event_type, event_created_at
  ) values (
    bounded_event_id, delivery.id, bounded_provider_identifier, provider_event_type, provider_event_created_at
  )
  on conflict do nothing
  returning event_id into inserted_event_id;

  if inserted_event_id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;

  provider_state := case provider_event_type
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.failed' then 'failed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.suppressed' then 'suppressed'
  end;

  update public.notification_deliveries
  set
    provider_status = provider_state,
    provider_event_at = provider_event_created_at,
    last_error_code = case
      when provider_state in ('failed', 'bounced', 'complained', 'suppressed') then 'provider_' || provider_state
      else null
    end
  where id = delivery.id
    and (provider_event_at is null or provider_event_created_at >= provider_event_at);

  suppression_reason := case
    when provider_state in ('bounced', 'complained', 'suppressed') then provider_state
    else null
  end;
  if suppression_reason is not null then
    update public.notification_preferences
    set
      email_enabled = false,
      email_suppressed_at = now(),
      email_suppression_reason = suppression_reason,
      email_suppression_event_at = provider_event_created_at
    where user_id = delivery.user_id
      and (email_suppression_event_at is null or provider_event_created_at > email_suppression_event_at);
  end if;

  return jsonb_build_object('result', 'processed');
end;
$$;

alter function public.export_account_data() rename to export_account_data_before_delivery_health;
revoke all on function public.export_account_data_before_delivery_health() from public, anon, authenticated;

create or replace function public.export_account_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  result jsonb;
  preferences jsonb;
  deliveries jsonb;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  result := public.export_account_data_before_delivery_health();
  select jsonb_build_object(
    'emailEnabled', preference.email_enabled,
    'pausedScheduleEnabled', preference.paused_schedule_enabled,
    'timezone', preference.timezone,
    'emailSuppressedAt', preference.email_suppressed_at,
    'emailSuppressionReason', preference.email_suppression_reason,
    'createdAt', preference.created_at,
    'updatedAt', preference.updated_at
  ) into preferences
  from public.notification_preferences as preference
  where preference.user_id = caller;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'ledgerId', delivery.ledger_id,
      'subscriptionId', delivery.subscription_id,
      'reminderKind', delivery.reminder_kind,
      'scheduledDate', delivery.scheduled_date,
      'leadDays', delivery.lead_days,
      'subscriptionName', delivery.subscription_name,
      'amount', delivery.amount,
      'currency', delivery.currency,
      'ledgerName', delivery.ledger_name,
      'ledgerKind', delivery.ledger_kind,
      'channel', delivery.channel,
      'status', delivery.status,
      'providerStatus', delivery.provider_status,
      'attemptCount', delivery.attempt_count,
      'sentAt', delivery.sent_at,
      'createdAt', delivery.created_at,
      'updatedAt', delivery.updated_at
    ) order by delivery.scheduled_date, delivery.created_at, delivery.id
  ), '[]'::jsonb) into deliveries
  from public.notification_deliveries as delivery
  where delivery.user_id = caller;

  result := jsonb_set(result, '{notificationPreferences}', coalesce(preferences, 'null'::jsonb), true);
  result := jsonb_set(result, '{emailReminderDeliveries}', deliveries, true);
  return result;
end;
$$;

revoke all on function public.save_notification_preferences(boolean, boolean, text) from public, anon;
revoke all on function public.resume_email_notifications() from public, anon;
revoke all on function public.complete_email_notification(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.record_email_provider_event(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.export_account_data() from public, anon;
grant execute on function public.save_notification_preferences(boolean, boolean, text) to authenticated;
grant execute on function public.resume_email_notifications() to authenticated;
grant execute on function public.complete_email_notification(uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.record_email_provider_event(text, text, text, timestamptz) to service_role;
grant execute on function public.export_account_data() to authenticated;

alter publication supabase_realtime add table public.notification_preferences;
