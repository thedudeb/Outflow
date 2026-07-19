create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ledger_id text not null references public.ledgers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  include_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  last_access_at timestamptz,
  unique (user_id, ledger_id)
);

create index calendar_feeds_ledger_idx on public.calendar_feeds (ledger_id);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from public, anon, authenticated;

create or replace function public.revoke_calendar_feed_after_membership_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_feeds
  where ledger_id = old.ledger_id and user_id = old.user_id;
  return old;
end;
$$;

create trigger revoke_calendar_feed_on_membership_delete
after delete on public.ledger_members
for each row execute function public.revoke_calendar_feed_after_membership_delete();

create or replace function public.get_calendar_feed(target_ledger_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  result jsonb;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' then
    raise exception 'Ledger identifier is invalid.';
  end if;

  select jsonb_build_object(
    'id', feed.id,
    'ledgerId', feed.ledger_id,
    'ledgerName', ledger.name,
    'includePaused', feed.include_paused,
    'createdAt', feed.created_at,
    'updatedAt', feed.updated_at,
    'rotatedAt', feed.rotated_at,
    'lastAccessAt', feed.last_access_at
  ) into result
  from public.calendar_feeds as feed
  join public.ledgers as ledger on ledger.id = feed.ledger_id
  where feed.user_id = caller
    and feed.ledger_id = target_ledger_id
    and exists (
      select 1 from public.ledger_members
      where ledger_members.ledger_id = feed.ledger_id and ledger_members.user_id = caller
    );
  return result;
end;
$$;

create or replace function public.create_or_rotate_calendar_feed(
  target_ledger_id text,
  requested_include_paused boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  feed_token text;
  feed_hash text;
  target_ledger public.ledgers;
  saved public.calendar_feeds;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' or requested_include_paused is null then
    raise exception 'Calendar feed details are invalid.';
  end if;
  if not public.has_lifetime_pro() then
    raise exception 'Outflow Pro is required for hosted calendars.' using errcode = '42501';
  end if;

  select ledger.* into target_ledger
  from public.ledgers as ledger
  join public.ledger_members as membership
    on membership.ledger_id = ledger.id and membership.user_id = caller
  where ledger.id = target_ledger_id;
  if not found then raise exception 'Cloud ledger access is required.' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || target_ledger_id, 0));
  feed_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  feed_hash := encode(extensions.digest(convert_to(feed_token, 'UTF8'), 'sha256'), 'hex');

  insert into public.calendar_feeds (user_id, ledger_id, token_hash, include_paused)
  values (caller, target_ledger_id, feed_hash, requested_include_paused)
  on conflict (user_id, ledger_id) do update set
    token_hash = excluded.token_hash,
    include_paused = excluded.include_paused,
    updated_at = now(),
    rotated_at = now(),
    last_access_at = null
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'ledgerId', saved.ledger_id,
    'ledgerName', target_ledger.name,
    'includePaused', saved.include_paused,
    'token', feed_token,
    'createdAt', saved.created_at,
    'updatedAt', saved.updated_at,
    'rotatedAt', saved.rotated_at,
    'lastAccessAt', saved.last_access_at
  );
end;
$$;

create or replace function public.set_calendar_feed_options(
  target_ledger_id text,
  requested_include_paused boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  saved public.calendar_feeds;
  ledger_name text;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' or requested_include_paused is null then
    raise exception 'Calendar feed details are invalid.';
  end if;
  if not public.has_lifetime_pro() or not public.is_ledger_member(target_ledger_id) then
    raise exception 'An active Pro ledger membership is required.' using errcode = '42501';
  end if;

  update public.calendar_feeds
  set include_paused = requested_include_paused, updated_at = now()
  where user_id = caller and ledger_id = target_ledger_id
  returning * into saved;
  if not found then raise exception 'Calendar feed is not published.' using errcode = 'P0002'; end if;
  select name into ledger_name from public.ledgers where id = target_ledger_id;

  return jsonb_build_object(
    'id', saved.id,
    'ledgerId', saved.ledger_id,
    'ledgerName', ledger_name,
    'includePaused', saved.include_paused,
    'createdAt', saved.created_at,
    'updatedAt', saved.updated_at,
    'rotatedAt', saved.rotated_at,
    'lastAccessAt', saved.last_access_at
  );
end;
$$;

create or replace function public.revoke_calendar_feed(target_ledger_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  changed integer;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if target_ledger_id is null or target_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' then
    raise exception 'Ledger identifier is invalid.';
  end if;
  delete from public.calendar_feeds where user_id = caller and ledger_id = target_ledger_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.resolve_calendar_feed(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  feed public.calendar_feeds;
  result jsonb;
begin
  if target_token_hash is null or target_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;

  select * into feed from public.calendar_feeds where token_hash = target_token_hash;
  if not found then return null; end if;
  if not exists (
    select 1 from public.entitlements
    where entitlements.user_id = feed.user_id
      and entitlements.product = 'outflow_pro_lifetime'
      and entitlements.status = 'active'
  ) or not exists (
    select 1 from public.ledger_members
    where ledger_members.ledger_id = feed.ledger_id and ledger_members.user_id = feed.user_id
  ) then return null;
  end if;

  update public.calendar_feeds set last_access_at = now() where id = feed.id;

  select jsonb_build_object(
    'feedId', feed.id,
    'includePaused', feed.include_paused,
    'rotatedAt', feed.rotated_at,
    'ledger', jsonb_build_object(
      'id', ledger.id,
      'name', ledger.name,
      'kind', ledger.kind,
      'revision', ledger.revision,
      'updatedAt', ledger.updated_at
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', subscription.id,
        'name', subscription.name,
        'amount', subscription.amount,
        'currency', subscription.currency,
        'cycle', subscription.cycle,
        'nextBillingDate', subscription.next_billing_date,
        'category', subscription.category,
        'paused', subscription.paused,
        'revision', subscription.revision,
        'updatedAt', coalesce(subscription.client_updated_at, subscription.updated_at)
      ) order by subscription.next_billing_date, subscription.name, subscription.id)
      from public.subscriptions as subscription
      where subscription.ledger_id = ledger.id
        and (not subscription.paused or feed.include_paused)
    ), '[]'::jsonb)
  ) into result
  from public.ledgers as ledger
  where ledger.id = feed.ledger_id;
  return result;
end;
$$;

revoke all on function public.get_calendar_feed(text) from public, anon;
revoke all on function public.revoke_calendar_feed_after_membership_delete() from public, anon, authenticated;
revoke all on function public.create_or_rotate_calendar_feed(text, boolean) from public, anon;
revoke all on function public.set_calendar_feed_options(text, boolean) from public, anon;
revoke all on function public.revoke_calendar_feed(text) from public, anon;
revoke all on function public.resolve_calendar_feed(text) from public, anon, authenticated;
grant execute on function public.get_calendar_feed(text) to authenticated;
grant execute on function public.create_or_rotate_calendar_feed(text, boolean) to authenticated;
grant execute on function public.set_calendar_feed_options(text, boolean) to authenticated;
grant execute on function public.revoke_calendar_feed(text) to authenticated;
grant execute on function public.resolve_calendar_feed(text) to service_role;
