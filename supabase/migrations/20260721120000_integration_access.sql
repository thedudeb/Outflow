create table public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_hint text not null check (char_length(token_hint) between 16 and 40),
  scopes text[] not null default '{read,write}' check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  request_window_started_at timestamptz not null default now(),
  request_window_count integer not null default 0 check (request_window_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index integration_tokens_user_created_idx
on public.integration_tokens (user_id, created_at desc);

alter table public.integration_tokens enable row level security;

create policy integration_tokens_select_self
on public.integration_tokens for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.integration_tokens from anon, authenticated, service_role;

create or replace function public.create_integration_token(
  requested_label text,
  requested_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_label text := regexp_replace(trim(coalesce(requested_label, '')), '\s+', ' ', 'g');
  token_expires_at timestamptz := coalesce(requested_expires_at, now() + interval '90 days');
  plaintext_token text;
  created_token public.integration_tokens;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if char_length(clean_label) not between 1 and 60 then
    raise exception 'Integration label is invalid.' using errcode = '22023';
  end if;
  if token_expires_at < now() + interval '1 day' or token_expires_at > now() + interval '366 days' then
    raise exception 'Integration token expiry must be between 1 and 366 days.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.entitlements
    where user_id = caller
      and product = 'outflow_pro_lifetime'
      and status = 'active'
  ) then
    raise exception 'Outflow Pro is required for API and MCP access.' using errcode = '42501';
  end if;
  if (
    select count(*) from public.integration_tokens
    where user_id = caller and revoked_at is null and expires_at > now()
  ) >= 10 then
    raise exception 'Revoke an existing integration token before creating another.' using errcode = '54000';
  end if;

  plaintext_token := 'outflow_pat_' || rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );

  insert into public.integration_tokens (
    user_id, label, token_hash, token_hint, scopes, expires_at
  ) values (
    caller,
    clean_label,
    encode(extensions.digest(plaintext_token, 'sha256'), 'hex'),
    'outflow_pat_...' || right(plaintext_token, 6),
    array['read', 'write']::text[],
    token_expires_at
  )
  returning * into created_token;

  return jsonb_build_object(
    'id', created_token.id,
    'label', created_token.label,
    'token', plaintext_token,
    'tokenHint', created_token.token_hint,
    'scopes', to_jsonb(created_token.scopes),
    'expiresAt', created_token.expires_at,
    'createdAt', created_token.created_at
  );
end;
$$;

create or replace function public.read_integration_tokens()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', token.id,
    'label', token.label,
    'tokenHint', token.token_hint,
    'scopes', to_jsonb(token.scopes),
    'expiresAt', token.expires_at,
    'lastUsedAt', token.last_used_at,
    'revokedAt', token.revoked_at,
    'createdAt', token.created_at
  ) order by token.created_at desc), '[]'::jsonb)
  from public.integration_tokens as token
  where token.user_id = (select auth.uid());
$$;

create or replace function public.revoke_integration_token(target_token_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  update public.integration_tokens
  set revoked_at = coalesce(revoked_at, now())
  where id = target_token_id and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.authenticate_integration_token(presented_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_token public.integration_tokens;
  requests_remaining integer;
begin
  if presented_token is null or presented_token !~ '^outflow_pat_[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select token.* into matched_token
  from public.integration_tokens as token
  join public.entitlements as entitlement
    on entitlement.user_id = token.user_id
    and entitlement.product = 'outflow_pro_lifetime'
    and entitlement.status = 'active'
  where token.token_hash = encode(extensions.digest(presented_token, 'sha256'), 'hex')
    and token.revoked_at is null
    and token.expires_at > now()
  for update of token;

  if not found then return null; end if;

  if matched_token.request_window_started_at <= now() - interval '10 minutes' then
    matched_token.request_window_started_at := now();
    matched_token.request_window_count := 0;
  end if;

  if matched_token.request_window_count >= 300 then
    return jsonb_build_object(
      'rateLimited', true,
      'requestsRemaining', 0,
      'windowResetsAt', matched_token.request_window_started_at + interval '10 minutes'
    );
  end if;

  matched_token.request_window_count := matched_token.request_window_count + 1;
  requests_remaining := greatest(0, 300 - matched_token.request_window_count);
  update public.integration_tokens
  set last_used_at = now(),
      request_window_started_at = matched_token.request_window_started_at,
      request_window_count = matched_token.request_window_count
  where id = matched_token.id;

  return jsonb_build_object(
    'tokenId', matched_token.id,
    'userId', matched_token.user_id,
    'scopes', to_jsonb(matched_token.scopes),
    'rateLimited', false,
    'requestsRemaining', requests_remaining,
    'windowResetsAt', matched_token.request_window_started_at + interval '10 minutes'
  );
end;
$$;

create or replace function public.integration_can_write_list(caller uuid, target_list_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ledgers as ledger
    join public.ledger_members as membership on membership.ledger_id = ledger.id
    where ledger.id = target_list_id
      and membership.user_id = caller
      and membership.role in ('owner', 'editor')
      and (
        (ledger.kind = 'personal' and exists (
          select 1 from public.entitlements
          where user_id = caller and product = 'outflow_pro_lifetime' and status = 'active'
        ))
        or (ledger.kind in ('household', 'team') and exists (
          select 1 from public.entitlements
          where user_id = ledger.owner_id and product = 'outflow_pro_lifetime' and status = 'active'
        ))
      )
  );
$$;

create or replace function public.integration_list_lists(caller uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ledger.id,
    'name', ledger.name,
    'kind', ledger.kind,
    'role', membership.role,
    'revision', ledger.revision,
    'canWrite', public.integration_can_write_list(caller, ledger.id),
    'createdAt', ledger.created_at,
    'updatedAt', ledger.updated_at
  ) order by ledger.created_at), '[]'::jsonb)
  from public.ledgers as ledger
  join public.ledger_members as membership on membership.ledger_id = ledger.id
  where membership.user_id = caller;
$$;

create or replace function public.integration_list_subscriptions(
  caller uuid,
  target_list_id text,
  include_paused boolean default true,
  due_before date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.ledger_members
    where ledger_id = target_list_id and user_id = caller
  ) then
    raise exception 'Subscription list is unavailable.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', subscription.id,
    'listId', subscription.ledger_id,
    'name', subscription.name,
    'amount', subscription.amount,
    'currency', subscription.currency,
    'cycle', subscription.cycle,
    'nextBillingDate', subscription.next_billing_date,
    'category', subscription.category,
    'tags', to_jsonb(subscription.tags),
    'color', subscription.color,
    'trialEndDate', subscription.trial_end_date,
    'reminderLeadDays', to_jsonb(subscription.reminder_lead_days),
    'paused', subscription.paused,
    'revision', subscription.revision,
    'createdAt', subscription.created_at,
    'updatedAt', subscription.updated_at
  ) order by subscription.next_billing_date, lower(subscription.name)), '[]'::jsonb)
  into result
  from public.subscriptions as subscription
  where subscription.ledger_id = target_list_id
    and (include_paused or not subscription.paused)
    and (due_before is null or subscription.next_billing_date <= due_before);

  return result;
end;
$$;

create or replace function public.integration_save_subscription(
  caller uuid,
  target_list_id text,
  target_subscription_id text,
  subscription_payload jsonb,
  create_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.subscriptions;
  merged jsonb;
  saved public.subscriptions;
  trial_date date;
begin
  if not public.integration_can_write_list(caller, target_list_id) then
    raise exception 'Editor access to an active Pro subscription list is required.' using errcode = '42501';
  end if;
  if target_subscription_id is null or target_subscription_id !~ '^[a-zA-Z0-9-]{1,100}$' then
    raise exception 'Subscription identifier is invalid.' using errcode = '22023';
  end if;
  if subscription_payload is null
    or jsonb_typeof(subscription_payload) <> 'object'
    or subscription_payload = '{}'::jsonb
    or octet_length(subscription_payload::text) > 32768 then
    raise exception 'Subscription payload is invalid.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(subscription_payload) as field
    where field not in (
      'name', 'amount', 'currency', 'cycle', 'nextBillingDate', 'category', 'tags',
      'color', 'trialEndDate', 'reminderLeadDays', 'paused'
    )
  ) then
    raise exception 'Subscription payload contains unsupported fields.' using errcode = '22023';
  end if;

  select * into existing from public.subscriptions
  where ledger_id = target_list_id and id = target_subscription_id
  for update;

  if create_only and found then
    raise exception 'Subscription identifier already exists.' using errcode = '23505';
  end if;
  if not create_only and not found then return null; end if;

  merged := case when existing.id is null then jsonb_build_object(
    'name', null,
    'amount', null,
    'currency', null,
    'cycle', null,
    'nextBillingDate', null,
    'category', null,
    'tags', '[]'::jsonb,
    'color', '#f59e0b',
    'trialEndDate', null,
    'reminderLeadDays', '[7]'::jsonb,
    'paused', false
  ) else jsonb_build_object(
    'name', existing.name,
    'amount', existing.amount,
    'currency', existing.currency,
    'cycle', existing.cycle,
    'nextBillingDate', existing.next_billing_date,
    'category', existing.category,
    'tags', to_jsonb(existing.tags),
    'color', existing.color,
    'trialEndDate', existing.trial_end_date,
    'reminderLeadDays', to_jsonb(existing.reminder_lead_days),
    'paused', existing.paused
  ) end || subscription_payload;

  if jsonb_typeof(merged -> 'name') is distinct from 'string'
    or coalesce(char_length(trim(merged ->> 'name')) not between 1 and 100, true) then
    raise exception 'Subscription name is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(merged -> 'amount') is distinct from 'number'
    or (merged ->> 'amount')::numeric <= 0
    or (merged ->> 'amount')::numeric > 1000000000 then
    raise exception 'Subscription amount is invalid.' using errcode = '22023';
  end if;
  if coalesce(merged ->> 'currency', '') not in ('USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF') then
    raise exception 'Subscription currency is invalid.' using errcode = '22023';
  end if;
  if coalesce(merged ->> 'cycle', '') not in ('weekly', 'monthly', 'yearly') then
    raise exception 'Subscription cycle is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(merged -> 'nextBillingDate') is distinct from 'string'
    or coalesce(merged ->> 'nextBillingDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Subscription billing date is invalid.' using errcode = '22023';
  end if;
  perform (merged ->> 'nextBillingDate')::date;
  if jsonb_typeof(merged -> 'category') is distinct from 'string'
    or coalesce(char_length(trim(merged ->> 'category')) not between 1 and 60, true) then
    raise exception 'Subscription category is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(merged -> 'tags') is distinct from 'array' or jsonb_array_length(merged -> 'tags') > 10
    or exists (
      select 1 from jsonb_array_elements(merged -> 'tags') as tag
      where jsonb_typeof(tag) <> 'string' or char_length(trim(tag #>> '{}')) not between 1 and 30
    ) then
    raise exception 'Subscription tags are invalid.' using errcode = '22023';
  end if;
  if coalesce(merged ->> 'color', '') not in ('#f59e0b', '#ef4444', '#22d3ee', '#84cc16', '#8b5cf6', '#94a3b8') then
    raise exception 'Subscription color is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(merged -> 'reminderLeadDays') is distinct from 'array'
    or jsonb_array_length(merged -> 'reminderLeadDays') > 12
    or exists (
      select 1 from jsonb_array_elements_text(merged -> 'reminderLeadDays') as reminder
      where reminder !~ '^\d{1,3}$' or reminder::integer < 0 or reminder::integer > 365
    ) then
    raise exception 'Subscription reminder lead times are invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(merged -> 'paused') is distinct from 'boolean' then
    raise exception 'Subscription pause state is invalid.' using errcode = '22023';
  end if;
  if merged -> 'trialEndDate' <> 'null'::jsonb then
    if jsonb_typeof(merged -> 'trialEndDate') <> 'string' or merged ->> 'trialEndDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Subscription trial date is invalid.' using errcode = '22023';
    end if;
    trial_date := (merged ->> 'trialEndDate')::date;
  end if;

  insert into public.subscriptions (
    ledger_id, id, name, amount, currency, cycle, next_billing_date, category, tags,
    color, trial_end_date, reminder_lead_days, paused, revision, created_by, updated_by,
    source_created_by, source_updated_by, client_updated_at
  ) values (
    target_list_id,
    target_subscription_id,
    trim(merged ->> 'name'),
    (merged ->> 'amount')::numeric,
    merged ->> 'currency',
    merged ->> 'cycle',
    (merged ->> 'nextBillingDate')::date,
    trim(merged ->> 'category'),
    array(select trim(value) from jsonb_array_elements_text(merged -> 'tags')),
    merged ->> 'color',
    trial_date,
    array(select value::integer from jsonb_array_elements_text(merged -> 'reminderLeadDays')),
    (merged ->> 'paused')::boolean,
    0,
    caller,
    caller,
    'API integration',
    'API integration',
    now()
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
    source_updated_by = 'API integration',
    client_updated_at = now()
  returning * into saved;

  update public.ledgers
  set revision = revision + 1
  where id = target_list_id;

  return jsonb_build_object(
    'id', saved.id,
    'listId', saved.ledger_id,
    'name', saved.name,
    'amount', saved.amount,
    'currency', saved.currency,
    'cycle', saved.cycle,
    'nextBillingDate', saved.next_billing_date,
    'category', saved.category,
    'tags', to_jsonb(saved.tags),
    'color', saved.color,
    'trialEndDate', saved.trial_end_date,
    'reminderLeadDays', to_jsonb(saved.reminder_lead_days),
    'paused', saved.paused,
    'revision', saved.revision,
    'createdAt', saved.created_at,
    'updatedAt', saved.updated_at
  );
end;
$$;

create or replace function public.integration_delete_subscription(
  caller uuid,
  target_list_id text,
  target_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.integration_can_write_list(caller, target_list_id) then
    raise exception 'Editor access to an active Pro subscription list is required.' using errcode = '42501';
  end if;
  delete from public.subscriptions
  where ledger_id = target_list_id and id = target_subscription_id;
  if not found then return false; end if;
  update public.ledgers set revision = revision + 1 where id = target_list_id;
  return true;
end;
$$;

revoke all on function public.create_integration_token(text, timestamptz) from public, anon;
revoke all on function public.read_integration_tokens() from public, anon;
revoke all on function public.revoke_integration_token(uuid) from public, anon;
revoke all on function public.authenticate_integration_token(text) from public, anon, authenticated;
revoke all on function public.integration_can_write_list(uuid, text) from public, anon, authenticated;
revoke all on function public.integration_list_lists(uuid) from public, anon, authenticated;
revoke all on function public.integration_list_subscriptions(uuid, text, boolean, date) from public, anon, authenticated;
revoke all on function public.integration_save_subscription(uuid, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.integration_delete_subscription(uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_integration_token(text, timestamptz) to authenticated;
grant execute on function public.read_integration_tokens() to authenticated;
grant execute on function public.revoke_integration_token(uuid) to authenticated;
grant execute on function public.authenticate_integration_token(text) to service_role;
grant execute on function public.integration_can_write_list(uuid, text) to service_role;
grant execute on function public.integration_list_lists(uuid) to service_role;
grant execute on function public.integration_list_subscriptions(uuid, text, boolean, date) to service_role;
grant execute on function public.integration_save_subscription(uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.integration_delete_subscription(uuid, text, text) to service_role;
