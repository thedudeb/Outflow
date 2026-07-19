create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ledgers (
  id text primary key check (id ~ '^[a-zA-Z0-9-]{1,100}$'),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('personal', 'household', 'team')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ledger_members (
  ledger_id text not null references public.ledgers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (ledger_id, user_id)
);

create table public.subscriptions (
  ledger_id text not null references public.ledgers(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9-]{1,100}$'),
  name text not null check (char_length(name) between 1 and 100),
  amount numeric(14, 4) not null check (amount > 0 and amount <= 1000000000),
  currency text not null check (currency in ('USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF')),
  cycle text not null check (cycle in ('weekly', 'monthly', 'yearly')),
  next_billing_date date not null,
  category text not null check (char_length(category) between 1 and 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  color text not null check (color in ('#f59e0b', '#ef4444', '#22d3ee', '#84cc16', '#8b5cf6', '#94a3b8')),
  trial_end_date date,
  reminder_lead_days integer[] not null default '{7}' check (reminder_lead_days <@ array[0, 1, 3, 7, 14, 30]),
  paused boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  source_created_by text not null default 'Local guest' check (char_length(source_created_by) between 1 and 60),
  source_updated_by text not null default 'Local guest' check (char_length(source_updated_by) between 1 and 60),
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ledger_id, id)
);

create table public.ledger_invitations (
  id uuid primary key default gen_random_uuid(),
  ledger_id text not null references public.ledgers(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  role text not null check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product = 'outflow_pro_lifetime'),
  status text not null check (status in ('active', 'refunded', 'revoked')),
  provider text not null check (provider in ('stripe', 'apple', 'google', 'manual')),
  provider_reference text not null,
  purchased_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product),
  unique (provider, provider_reference)
);

create table public.migration_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_hash text not null,
  client_schema integer not null,
  ledger_count integer not null check (ledger_count between 1 and 12),
  subscription_count integer not null check (subscription_count between 0 and 6000),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, workspace_hash)
);

create index ledger_members_user_id_idx on public.ledger_members(user_id);
create index subscriptions_ledger_next_date_idx on public.subscriptions(ledger_id, next_billing_date);
create index invitations_ledger_email_idx on public.ledger_invitations(ledger_id, lower(email));
create unique index ledgers_one_personal_per_owner_idx on public.ledgers(owner_id) where kind = 'personal';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger ledgers_touch_updated_at before update on public.ledgers
for each row execute function public.touch_updated_at();
create trigger subscriptions_touch_updated_at before update on public.subscriptions
for each row execute function public.touch_updated_at();
create trigger entitlements_touch_updated_at before update on public.entitlements
for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_user();

create or replace function public.is_ledger_member(target_ledger_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ledger_members
    where ledger_id = target_ledger_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_ledger(target_ledger_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ledger_members
    where ledger_id = target_ledger_id
      and user_id = (select auth.uid())
      and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_ledger_owner(target_ledger_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ledgers
    where id = target_ledger_id and owner_id = (select auth.uid())
  );
$$;

create or replace function public.has_lifetime_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements
    where user_id = (select auth.uid())
      and product = 'outflow_pro_lifetime'
      and status = 'active'
  );
$$;

alter table public.profiles enable row level security;
alter table public.ledgers enable row level security;
alter table public.ledger_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ledger_invitations enable row level security;
alter table public.entitlements enable row level security;
alter table public.migration_receipts enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ledgers_select_members on public.ledgers for select to authenticated
using (public.is_ledger_member(id) or owner_id = (select auth.uid()));
create policy ledgers_insert_owner on public.ledgers for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (kind = 'personal' or public.has_lifetime_pro())
);
create policy ledgers_update_owner on public.ledgers for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy ledgers_delete_owner on public.ledgers for delete to authenticated
using (owner_id = (select auth.uid()));

create policy members_select_members on public.ledger_members for select to authenticated
using (public.is_ledger_member(ledger_id));
create policy members_insert_owner on public.ledger_members for insert to authenticated
with check (
  public.is_ledger_owner(ledger_id)
  and (
    (user_id = (select auth.uid()) and role = 'owner')
    or public.has_lifetime_pro()
  )
);
create policy members_update_owner on public.ledger_members for update to authenticated
using (public.is_ledger_owner(ledger_id)) with check (public.is_ledger_owner(ledger_id));
create policy members_delete_owner_or_self on public.ledger_members for delete to authenticated
using (
  (public.is_ledger_owner(ledger_id) and user_id <> (select auth.uid()))
  or (user_id = (select auth.uid()) and role <> 'owner')
);

create policy subscriptions_select_members on public.subscriptions for select to authenticated
using (public.is_ledger_member(ledger_id));
create policy subscriptions_insert_editors on public.subscriptions for insert to authenticated
with check (public.can_edit_ledger(ledger_id) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy subscriptions_update_editors on public.subscriptions for update to authenticated
using (public.can_edit_ledger(ledger_id))
with check (public.can_edit_ledger(ledger_id) and updated_by = (select auth.uid()));
create policy subscriptions_delete_editors on public.subscriptions for delete to authenticated
using (public.can_edit_ledger(ledger_id));

create policy invitations_select_owner on public.ledger_invitations for select to authenticated
using (public.is_ledger_owner(ledger_id));
create policy invitations_insert_owner on public.ledger_invitations for insert to authenticated
with check (public.is_ledger_owner(ledger_id) and public.has_lifetime_pro() and invited_by = (select auth.uid()));
create policy invitations_update_owner on public.ledger_invitations for update to authenticated
using (public.is_ledger_owner(ledger_id)) with check (public.is_ledger_owner(ledger_id));
create policy invitations_delete_owner on public.ledger_invitations for delete to authenticated
using (public.is_ledger_owner(ledger_id));

create policy entitlements_select_self on public.entitlements for select to authenticated
using (user_id = (select auth.uid()));
create policy migration_receipts_select_self on public.migration_receipts for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.profiles, public.ledgers, public.ledger_members, public.subscriptions,
  public.ledger_invitations, public.entitlements, public.migration_receipts from anon;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, delete on public.ledgers to authenticated;
grant update (name, kind, revision) on public.ledgers to authenticated;
grant select, insert, delete on public.ledger_members to authenticated;
grant update (role) on public.ledger_members to authenticated;
grant select, insert, delete on public.subscriptions to authenticated;
grant update (
  name, amount, currency, cycle, next_billing_date, category, tags, color, trial_end_date,
  reminder_lead_days, paused, revision, updated_by, source_updated_by, client_updated_at
) on public.subscriptions to authenticated;
grant select, insert, delete on public.ledger_invitations to authenticated;
grant update (role, expires_at, accepted_at) on public.ledger_invitations to authenticated;
grant select on public.entitlements, public.migration_receipts to authenticated;

create or replace function public.migrate_guest_workspace(workspace_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  ledger_entry jsonb;
  ledger_data jsonb;
  subscription_data jsonb;
  current_ledger_id text;
  ledger_total integer;
  subscription_total integer := 0;
  personal_total integer;
  payload_hash text;
  existing_result jsonb;
  receipt_id uuid := gen_random_uuid();
  result_payload jsonb;
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if jsonb_typeof(workspace_payload) <> 'object' then raise exception 'Workspace root must be an object.'; end if;
  if (workspace_payload ->> 'schemaVersion')::integer <> 1 then raise exception 'Workspace version is not supported.'; end if;
  if jsonb_typeof(workspace_payload -> 'ledgers') <> 'array' then raise exception 'Workspace ledgers must be an array.'; end if;

  ledger_total := jsonb_array_length(workspace_payload -> 'ledgers');
  if ledger_total < 1 or ledger_total > 12 then raise exception 'Workspace ledger count is invalid.'; end if;

  select count(*) into personal_total
  from jsonb_array_elements(workspace_payload -> 'ledgers') as entry
  where entry -> 'ledger' ->> 'kind' = 'personal';
  if personal_total <> 1 then raise exception 'Workspace must contain exactly one personal ledger.'; end if;
  if (
    select count(distinct entry -> 'ledger' ->> 'id') <> count(*)
    from jsonb_array_elements(workspace_payload -> 'ledgers') as entry
  ) then raise exception 'Workspace ledger identifiers must be unique.'; end if;
  if exists (
    select 1 from jsonb_array_elements(workspace_payload -> 'ledgers') as entry
    where entry -> 'ledger' ->> 'kind' in ('household', 'team')
  ) and not public.has_lifetime_pro() then
    raise exception 'An active Pro entitlement is required to upload household or team ledgers.' using errcode = '42501';
  end if;

  payload_hash := encode(extensions.digest(convert_to(workspace_payload::text, 'UTF8'), 'sha256'), 'hex');
  select result into existing_result
  from public.migration_receipts
  where user_id = caller and workspace_hash = payload_hash;
  if found then return existing_result; end if;

  for ledger_entry in select value from jsonb_array_elements(workspace_payload -> 'ledgers') loop
    ledger_data := ledger_entry -> 'ledger';
    current_ledger_id := ledger_data ->> 'id';
    if current_ledger_id is null or current_ledger_id !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Ledger identifier is invalid.'; end if;
    if coalesce(char_length(trim(ledger_data ->> 'name')), 0) not between 1 and 60 then raise exception 'Ledger name is invalid.'; end if;
    if ledger_data ->> 'kind' not in ('personal', 'household', 'team') then raise exception 'Ledger kind is invalid.'; end if;
    if jsonb_typeof(ledger_entry -> 'subscriptions') <> 'array' then raise exception 'Ledger subscriptions must be an array.'; end if;
    if jsonb_array_length(ledger_entry -> 'subscriptions') > 500 then raise exception 'Ledger exceeds subscription capacity.'; end if;
    if exists (select 1 from public.ledgers where id = current_ledger_id and owner_id <> caller) then
      raise exception 'A ledger identifier is already owned by another account.' using errcode = '23505';
    end if;

    insert into public.ledgers (id, name, kind, owner_id)
    values (current_ledger_id, trim(ledger_data ->> 'name'), ledger_data ->> 'kind', caller)
    on conflict (id) do update set
      name = excluded.name,
      kind = excluded.kind,
      revision = public.ledgers.revision + 1
    where public.ledgers.owner_id = caller;

    insert into public.ledger_members (ledger_id, user_id, role)
    values (current_ledger_id, caller, 'owner')
    on conflict (ledger_id, user_id) do update set role = 'owner';

    if (
      select count(distinct subscription ->> 'id') <> count(*)
      from jsonb_array_elements(ledger_entry -> 'subscriptions') as subscription
    ) then raise exception 'Subscription identifiers must be unique within a ledger.'; end if;

    for subscription_data in select value from jsonb_array_elements(ledger_entry -> 'subscriptions') loop
      if subscription_data ->> 'id' is null or subscription_data ->> 'id' !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Subscription identifier is invalid.'; end if;
      if coalesce(char_length(trim(subscription_data ->> 'name')), 0) not between 1 and 100 then raise exception 'Subscription name is invalid.'; end if;
      if jsonb_typeof(subscription_data -> 'amount') <> 'number' then raise exception 'Subscription amount is invalid.'; end if;
      if (subscription_data ->> 'amount')::numeric <= 0 or (subscription_data ->> 'amount')::numeric > 1000000000 then raise exception 'Subscription amount is invalid.'; end if;
      if subscription_data ->> 'currency' not in ('USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF') then raise exception 'Subscription currency is invalid.'; end if;
      if subscription_data ->> 'cycle' not in ('weekly', 'monthly', 'yearly') then raise exception 'Subscription cycle is invalid.'; end if;
      if subscription_data ->> 'nextBillingDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Subscription billing date is invalid.'; end if;
      if jsonb_typeof(subscription_data -> 'tags') <> 'array' or jsonb_array_length(subscription_data -> 'tags') > 10 then raise exception 'Subscription tags are invalid.'; end if;
      if jsonb_typeof(subscription_data -> 'reminderLeadDays') <> 'array' then raise exception 'Subscription reminders are invalid.'; end if;

      insert into public.subscriptions (
        ledger_id, id, name, amount, currency, cycle, next_billing_date, category, tags, color,
        trial_end_date, reminder_lead_days, paused, revision, created_by, updated_by,
        source_created_by, source_updated_by, client_updated_at
      ) values (
        current_ledger_id,
        subscription_data ->> 'id',
        trim(subscription_data ->> 'name'),
        (subscription_data ->> 'amount')::numeric,
        subscription_data ->> 'currency',
        subscription_data ->> 'cycle',
        (subscription_data ->> 'nextBillingDate')::date,
        left(coalesce(nullif(trim(subscription_data ->> 'category'), ''), 'Unsorted'), 60),
        array(select left(value, 24) from jsonb_array_elements_text(subscription_data -> 'tags')),
        subscription_data ->> 'color',
        nullif(subscription_data ->> 'trialEndDate', '')::date,
        array(select value::integer from jsonb_array_elements_text(subscription_data -> 'reminderLeadDays')),
        coalesce((subscription_data ->> 'paused')::boolean, false),
        greatest(coalesce((subscription_data ->> 'revision')::bigint, 0), 0),
        caller,
        caller,
        left(coalesce(nullif(trim(subscription_data ->> 'createdBy'), ''), 'Local guest'), 60),
        left(coalesce(nullif(trim(subscription_data ->> 'updatedBy'), ''), 'Local guest'), 60),
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
        revision = greatest(public.subscriptions.revision, excluded.revision),
        updated_by = caller,
        source_updated_by = excluded.source_updated_by,
        client_updated_at = excluded.client_updated_at;

      subscription_total := subscription_total + 1;
    end loop;
  end loop;

  result_payload := jsonb_build_object(
    'receiptId', receipt_id,
    'ledgerCount', ledger_total,
    'subscriptionCount', subscription_total,
    'workspaceHash', payload_hash
  );
  insert into public.migration_receipts (
    id, user_id, workspace_hash, client_schema, ledger_count, subscription_count, result
  ) values (
    receipt_id, caller, payload_hash, 1, ledger_total, subscription_total, result_payload
  );
  return result_payload;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.create_profile_for_user() from public, anon, authenticated;
revoke all on function public.is_ledger_member(text) from public, anon;
revoke all on function public.can_edit_ledger(text) from public, anon;
revoke all on function public.is_ledger_owner(text) from public, anon;
revoke all on function public.has_lifetime_pro() from public, anon;
revoke all on function public.migrate_guest_workspace(jsonb) from public, anon;
grant execute on function public.is_ledger_member(text) to authenticated;
grant execute on function public.can_edit_ledger(text) to authenticated;
grant execute on function public.is_ledger_owner(text) to authenticated;
grant execute on function public.has_lifetime_pro() to authenticated;
grant execute on function public.migrate_guest_workspace(jsonb) to authenticated;

alter publication supabase_realtime add table public.ledgers, public.ledger_members, public.subscriptions;
