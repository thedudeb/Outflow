create table public.ledger_sync_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  ledger_id text not null references public.ledgers(id) on delete cascade,
  base_revision bigint not null check (base_revision >= 0),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create index ledger_sync_operations_ledger_created_idx
on public.ledger_sync_operations (ledger_id, created_at desc);

alter table public.ledger_sync_operations enable row level security;
create policy sync_operations_select_self on public.ledger_sync_operations for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.ledger_sync_operations from anon;
grant select on public.ledger_sync_operations to authenticated;

create or replace function public.ledger_owner_has_lifetime_pro(target_ledger_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ledgers
    join public.entitlements on entitlements.user_id = ledgers.owner_id
    where ledgers.id = target_ledger_id
      and entitlements.product = 'outflow_pro_lifetime'
      and entitlements.status = 'active'
  );
$$;

create or replace function public.can_sync_ledger(target_ledger_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ledgers
    join public.ledger_members on ledger_members.ledger_id = ledgers.id
    where ledgers.id = target_ledger_id
      and ledger_members.user_id = (select auth.uid())
      and ledger_members.role in ('owner', 'editor')
      and (
        (ledgers.kind = 'personal' and public.has_lifetime_pro())
        or (ledgers.kind in ('household', 'team') and public.ledger_owner_has_lifetime_pro(ledgers.id))
      )
  );
$$;

create or replace function public.replace_ledger_snapshot(
  target_ledger_id text,
  expected_revision bigint,
  client_operation_id uuid,
  subscriptions_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_revision bigint;
  subscription_data jsonb;
  subscription_count integer;
  existing_result jsonb;
  result_payload jsonb;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Ledger identifier is invalid.'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Ledger revision is invalid.'; end if;
  if client_operation_id is null then raise exception 'Operation identifier is required.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text || ':' || client_operation_id::text, 0)
  );
  select result into existing_result
  from public.ledger_sync_operations
  where user_id = caller and operation_id = client_operation_id;
  if found then return existing_result; end if;

  delete from public.ledger_sync_operations
  where user_id = caller and created_at < now() - interval '30 days';
  if (select count(*) from public.ledger_sync_operations where user_id = caller) >= 10000 then
    raise exception 'Too many synchronization operations. Try again later.' using errcode = '54000';
  end if;

  if jsonb_typeof(subscriptions_payload) <> 'array' then raise exception 'Subscriptions must be an array.'; end if;
  if octet_length(subscriptions_payload::text) > 2097152 then raise exception 'Subscription snapshot is too large.'; end if;

  subscription_count := jsonb_array_length(subscriptions_payload);
  if subscription_count > 500 then raise exception 'Ledger exceeds subscription capacity.'; end if;
  if (
    select count(distinct subscription ->> 'id') <> count(*)
    from jsonb_array_elements(subscriptions_payload) as subscription
  ) then raise exception 'Subscription identifiers must be unique within a ledger.'; end if;

  select revision into current_revision
  from public.ledgers
  where id = target_ledger_id
  for update;
  if not found or not public.can_sync_ledger(target_ledger_id) then
    raise exception 'An active Pro editor is required to synchronize this ledger.' using errcode = '42501';
  end if;

  if current_revision <> expected_revision then
    result_payload := jsonb_build_object(
      'status', 'conflict',
      'ledgerId', target_ledger_id,
      'baseRevision', expected_revision,
      'currentRevision', current_revision
    );
    insert into public.ledger_sync_operations (user_id, operation_id, ledger_id, base_revision, result)
    values (caller, client_operation_id, target_ledger_id, expected_revision, result_payload);
    return result_payload;
  end if;

  for subscription_data in select value from jsonb_array_elements(subscriptions_payload) loop
    if subscription_data ->> 'id' is null or subscription_data ->> 'id' !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Subscription identifier is invalid.'; end if;
    if coalesce(char_length(trim(subscription_data ->> 'name')), 0) not between 1 and 100 then raise exception 'Subscription name is invalid.'; end if;
    if jsonb_typeof(subscription_data -> 'amount') <> 'number' then raise exception 'Subscription amount is invalid.'; end if;
    if (subscription_data ->> 'amount')::numeric <= 0 or (subscription_data ->> 'amount')::numeric > 1000000000 then raise exception 'Subscription amount is invalid.'; end if;
    if subscription_data ->> 'currency' not in ('USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF') then raise exception 'Subscription currency is invalid.'; end if;
    if subscription_data ->> 'cycle' not in ('weekly', 'monthly', 'yearly') then raise exception 'Subscription cycle is invalid.'; end if;
    if subscription_data ->> 'nextBillingDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Subscription billing date is invalid.'; end if;
    if coalesce(char_length(trim(subscription_data ->> 'category')), 0) not between 1 and 60 then raise exception 'Subscription category is invalid.'; end if;
    if subscription_data ->> 'color' not in ('#f59e0b', '#ef4444', '#22d3ee', '#84cc16', '#8b5cf6', '#94a3b8') then raise exception 'Subscription color is invalid.'; end if;
    if jsonb_typeof(subscription_data -> 'tags') <> 'array' or jsonb_array_length(subscription_data -> 'tags') > 10 then raise exception 'Subscription tags are invalid.'; end if;
    if exists (
      select 1 from jsonb_array_elements_text(subscription_data -> 'tags') as tag
      where char_length(tag) not between 1 and 24
    ) then raise exception 'Subscription tags are invalid.'; end if;
    if jsonb_typeof(subscription_data -> 'reminderLeadDays') <> 'array' then raise exception 'Subscription reminders are invalid.'; end if;
    if exists (
      select 1 from jsonb_array_elements_text(subscription_data -> 'reminderLeadDays') as reminder
      where reminder::integer not in (0, 1, 3, 7, 14, 30)
    ) then raise exception 'Subscription reminders are invalid.'; end if;

    insert into public.subscriptions (
      ledger_id, id, name, amount, currency, cycle, next_billing_date, category, tags, color,
      trial_end_date, reminder_lead_days, paused, revision, created_by, updated_by,
      source_created_by, source_updated_by, client_updated_at
    ) values (
      target_ledger_id,
      subscription_data ->> 'id',
      trim(subscription_data ->> 'name'),
      (subscription_data ->> 'amount')::numeric,
      subscription_data ->> 'currency',
      subscription_data ->> 'cycle',
      (subscription_data ->> 'nextBillingDate')::date,
      trim(subscription_data ->> 'category'),
      array(select value from jsonb_array_elements_text(subscription_data -> 'tags')),
      subscription_data ->> 'color',
      nullif(subscription_data ->> 'trialEndDate', '')::date,
      array(select value::integer from jsonb_array_elements_text(subscription_data -> 'reminderLeadDays')),
      coalesce((subscription_data ->> 'paused')::boolean, false),
      0,
      caller,
      caller,
      left(coalesce(nullif(trim(subscription_data ->> 'createdBy'), ''), 'Cloud account'), 60),
      left(coalesce(nullif(trim(subscription_data ->> 'updatedBy'), ''), 'Cloud account'), 60),
      nullif(subscription_data ->> 'updatedAt', '')::timestamptz
    )
    on conflict (ledger_id, id) do update set
      name = excluded.name,
      amount = excluded.amount,
      currency = excluded.currency,
      cycle = excluded.cycle,
      next_billing_date = excluded.next_billing_date,
      category = excluded.category,
      tags = excluded.tags,
      color = excluded.color,
      trial_end_date = excluded.trial_end_date,
      reminder_lead_days = excluded.reminder_lead_days,
      paused = excluded.paused,
      revision = public.subscriptions.revision + 1,
      updated_by = caller,
      source_updated_by = excluded.source_updated_by,
      client_updated_at = excluded.client_updated_at
    where row(
      public.subscriptions.name,
      public.subscriptions.amount,
      public.subscriptions.currency,
      public.subscriptions.cycle,
      public.subscriptions.next_billing_date,
      public.subscriptions.category,
      public.subscriptions.tags,
      public.subscriptions.color,
      public.subscriptions.trial_end_date,
      public.subscriptions.reminder_lead_days,
      public.subscriptions.paused
    ) is distinct from row(
      excluded.name,
      excluded.amount,
      excluded.currency,
      excluded.cycle,
      excluded.next_billing_date,
      excluded.category,
      excluded.tags,
      excluded.color,
      excluded.trial_end_date,
      excluded.reminder_lead_days,
      excluded.paused
    );
  end loop;

  delete from public.subscriptions
  where ledger_id = target_ledger_id
    and not exists (
      select 1 from jsonb_array_elements(subscriptions_payload) as subscription
      where subscription ->> 'id' = public.subscriptions.id
    );

  update public.ledgers
  set revision = revision + 1
  where id = target_ledger_id
  returning revision into current_revision;

  result_payload := jsonb_build_object(
    'status', 'applied',
    'ledgerId', target_ledger_id,
    'baseRevision', expected_revision,
    'currentRevision', current_revision,
    'subscriptionCount', subscription_count
  );
  insert into public.ledger_sync_operations (user_id, operation_id, ledger_id, base_revision, result)
  values (caller, client_operation_id, target_ledger_id, expected_revision, result_payload);

  return result_payload;
end;
$$;

create or replace function public.rename_cloud_ledger(
  target_ledger_id text,
  expected_revision bigint,
  client_operation_id uuid,
  ledger_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_revision bigint;
  existing_result jsonb;
  result_payload jsonb;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Ledger identifier is invalid.'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Ledger revision is invalid.'; end if;
  if client_operation_id is null then raise exception 'Operation identifier is required.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text || ':' || client_operation_id::text, 0)
  );
  select result into existing_result
  from public.ledger_sync_operations
  where user_id = caller and operation_id = client_operation_id;
  if found then return existing_result; end if;

  delete from public.ledger_sync_operations
  where user_id = caller and created_at < now() - interval '30 days';
  if (select count(*) from public.ledger_sync_operations where user_id = caller) >= 10000 then
    raise exception 'Too many synchronization operations. Try again later.' using errcode = '54000';
  end if;

  if ledger_name is null or char_length(trim(ledger_name)) not between 1 and 60 then raise exception 'Ledger name is invalid.'; end if;

  select revision into current_revision
  from public.ledgers
  where id = target_ledger_id
  for update;
  if not found or not public.is_ledger_owner(target_ledger_id) or not public.can_sync_ledger(target_ledger_id) then
    raise exception 'An active Pro owner is required to rename this ledger.' using errcode = '42501';
  end if;

  if current_revision <> expected_revision then
    result_payload := jsonb_build_object(
      'status', 'conflict',
      'ledgerId', target_ledger_id,
      'baseRevision', expected_revision,
      'currentRevision', current_revision
    );
    insert into public.ledger_sync_operations (user_id, operation_id, ledger_id, base_revision, result)
    values (caller, client_operation_id, target_ledger_id, expected_revision, result_payload);
    return result_payload;
  end if;

  update public.ledgers
  set name = trim(ledger_name), revision = revision + 1
  where id = target_ledger_id
  returning revision into current_revision;

  result_payload := jsonb_build_object(
    'status', 'applied',
    'ledgerId', target_ledger_id,
    'baseRevision', expected_revision,
    'currentRevision', current_revision,
    'name', trim(ledger_name)
  );
  insert into public.ledger_sync_operations (user_id, operation_id, ledger_id, base_revision, result)
  values (caller, client_operation_id, target_ledger_id, expected_revision, result_payload);
  return result_payload;
end;
$$;

revoke all on function public.ledger_owner_has_lifetime_pro(text) from public, anon;
revoke all on function public.can_sync_ledger(text) from public, anon;
revoke all on function public.replace_ledger_snapshot(text, bigint, uuid, jsonb) from public, anon;
revoke all on function public.rename_cloud_ledger(text, bigint, uuid, text) from public, anon;
grant execute on function public.can_sync_ledger(text) to authenticated;
grant execute on function public.replace_ledger_snapshot(text, bigint, uuid, jsonb) to authenticated;
grant execute on function public.rename_cloud_ledger(text, bigint, uuid, text) to authenticated;
