create table public.stripe_purchases (
  checkout_session_id text primary key check (checkout_session_id ~ '^cs_(test_|live_)[a-zA-Z0-9]+$'),
  user_id uuid references auth.users(id) on delete set null,
  payment_intent_id text not null unique check (payment_intent_id ~ '^pi_[a-zA-Z0-9]+$'),
  livemode boolean not null,
  status text not null check (status in ('paid', 'refunded')),
  purchased_at timestamptz not null,
  refunded_at timestamptz,
  provider_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid' and refunded_at is null) or (status = 'refunded' and refunded_at is not null))
);

create table public.billing_events (
  event_id text primary key check (event_id ~ '^evt_[a-zA-Z0-9]+$'),
  event_type text not null check (event_type in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'charge.refunded'
  )),
  result text not null check (result in ('fulfilled', 'refunded', 'stale')),
  processed_at timestamptz not null default now()
);

create table public.billing_checkout_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create index stripe_purchases_user_purchased_idx
on public.stripe_purchases (user_id, purchased_at desc);

alter table public.stripe_purchases enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_checkout_requests enable row level security;

create trigger stripe_purchases_touch_updated_at before update on public.stripe_purchases
for each row execute function public.touch_updated_at();

revoke all on public.stripe_purchases, public.billing_events, public.billing_checkout_requests from public, anon, authenticated;

create or replace function public.reserve_pro_checkout(client_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if client_operation_id is null then raise exception 'Checkout operation identifier is required.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 0));
  if exists (
    select 1 from public.billing_checkout_requests
    where user_id = caller and operation_id = client_operation_id
  ) then
    return jsonb_build_object('status', 'replay', 'operationId', client_operation_id);
  end if;

  delete from public.billing_checkout_requests
  where user_id = caller and created_at < now() - interval '24 hours';
  if (
    select count(*) from public.billing_checkout_requests
    where user_id = caller and created_at >= now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Checkout request limit reached. Try again later.' using errcode = '54000';
  end if;

  insert into public.billing_checkout_requests (user_id, operation_id)
  values (caller, client_operation_id);
  return jsonb_build_object('status', 'reserved', 'operationId', client_operation_id);
end;
$$;

create or replace function public.fulfill_stripe_pro_purchase(
  provider_event_id text,
  provider_event_type text,
  target_checkout_session_id text,
  target_payment_intent_id text,
  target_user_id uuid,
  event_livemode boolean,
  payment_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_events integer;
begin
  if provider_event_id is null or provider_event_id !~ '^evt_[a-zA-Z0-9]+$' then raise exception 'Billing event identifier is invalid.'; end if;
  if provider_event_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then raise exception 'Billing event type is invalid.'; end if;
  if target_checkout_session_id is null or target_checkout_session_id !~ '^cs_(test_|live_)[a-zA-Z0-9]+$' then raise exception 'Checkout session identifier is invalid.'; end if;
  if target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[a-zA-Z0-9]+$' then raise exception 'Payment intent identifier is invalid.'; end if;
  if target_user_id is null then raise exception 'Purchase user is required.'; end if;
  if event_livemode is null then raise exception 'Purchase mode is required.'; end if;
  if payment_completed_at is null or payment_completed_at > now() + interval '5 minutes' then raise exception 'Purchase timestamp is invalid.'; end if;

  insert into public.billing_events (event_id, event_type, result)
  values (provider_event_id, provider_event_type, 'fulfilled')
  on conflict (event_id) do nothing;
  get diagnostics inserted_events = row_count;
  if inserted_events = 0 then
    return jsonb_build_object('status', 'duplicate', 'eventId', provider_event_id);
  end if;

  insert into public.stripe_purchases (
    checkout_session_id, user_id, payment_intent_id, livemode, status, purchased_at, provider_updated_at
  ) values (
    target_checkout_session_id, target_user_id, target_payment_intent_id, event_livemode, 'paid', payment_completed_at, payment_completed_at
  )
  on conflict (checkout_session_id) do update set
    status = 'paid',
    purchased_at = excluded.purchased_at,
    refunded_at = null,
    provider_updated_at = excluded.provider_updated_at
  where public.stripe_purchases.user_id = excluded.user_id
    and public.stripe_purchases.payment_intent_id = excluded.payment_intent_id
    and public.stripe_purchases.livemode = excluded.livemode
    and (
      excluded.provider_updated_at > public.stripe_purchases.provider_updated_at
      or (
        excluded.provider_updated_at = public.stripe_purchases.provider_updated_at
        and public.stripe_purchases.status = 'paid'
      )
    );
  if not found then
    if exists (
      select 1 from public.stripe_purchases
      where stripe_purchases.checkout_session_id = target_checkout_session_id
        and stripe_purchases.user_id is null
        and stripe_purchases.payment_intent_id = target_payment_intent_id
        and stripe_purchases.livemode = event_livemode
    ) then
      update public.billing_events set result = 'stale' where event_id = provider_event_id;
      return jsonb_build_object('status', 'account-deleted', 'eventId', provider_event_id);
    end if;
    if not exists (
      select 1 from public.stripe_purchases
      where stripe_purchases.checkout_session_id = target_checkout_session_id
        and stripe_purchases.user_id = target_user_id
        and stripe_purchases.payment_intent_id = target_payment_intent_id
        and stripe_purchases.livemode = event_livemode
    ) then
      raise exception 'Checkout session identity does not match the original purchase.' using errcode = '23505';
    end if;
    update public.billing_events set result = 'stale' where event_id = provider_event_id;
    return jsonb_build_object('status', 'stale', 'eventId', provider_event_id);
  end if;

  insert into public.entitlements (
    user_id, product, status, provider, provider_reference, purchased_at, revoked_at
  ) values (
    target_user_id, 'outflow_pro_lifetime', 'active', 'stripe', target_checkout_session_id, payment_completed_at, null
  )
  on conflict (user_id, product) do update set
    status = 'active',
    provider = 'stripe',
    provider_reference = excluded.provider_reference,
    purchased_at = excluded.purchased_at,
    revoked_at = null;

  return jsonb_build_object(
    'status', 'fulfilled',
    'eventId', provider_event_id,
    'checkoutSessionId', target_checkout_session_id,
    'userId', target_user_id
  );
end;
$$;

create or replace function public.refund_stripe_pro_purchase(
  provider_event_id text,
  target_payment_intent_id text,
  payment_refunded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_events integer;
  purchase_user_id uuid;
  purchase_session_id text;
  purchase_provider_updated_at timestamptz;
  entitlement_revoked boolean := false;
begin
  if provider_event_id is null or provider_event_id !~ '^evt_[a-zA-Z0-9]+$' then raise exception 'Billing event identifier is invalid.'; end if;
  if target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[a-zA-Z0-9]+$' then raise exception 'Payment intent identifier is invalid.'; end if;
  if payment_refunded_at is null or payment_refunded_at > now() + interval '5 minutes' then raise exception 'Refund timestamp is invalid.'; end if;

  insert into public.billing_events (event_id, event_type, result)
  values (provider_event_id, 'charge.refunded', 'refunded')
  on conflict (event_id) do nothing;
  get diagnostics inserted_events = row_count;
  if inserted_events = 0 then
    return jsonb_build_object('status', 'duplicate', 'eventId', provider_event_id);
  end if;

  select user_id, checkout_session_id, provider_updated_at
  into purchase_user_id, purchase_session_id, purchase_provider_updated_at
  from public.stripe_purchases
  where stripe_purchases.payment_intent_id = target_payment_intent_id
  for update;
  if not found then raise exception 'The refunded Outflow purchase is not available yet.' using errcode = 'P0002'; end if;

  if payment_refunded_at < purchase_provider_updated_at then
    update public.billing_events set result = 'stale' where event_id = provider_event_id;
    return jsonb_build_object('status', 'stale', 'eventId', provider_event_id);
  end if;

  update public.stripe_purchases
  set status = 'refunded', refunded_at = payment_refunded_at, provider_updated_at = payment_refunded_at
  where checkout_session_id = purchase_session_id;

  update public.entitlements
  set status = 'refunded', revoked_at = payment_refunded_at
  where user_id = purchase_user_id
    and product = 'outflow_pro_lifetime'
    and provider = 'stripe'
    and provider_reference = purchase_session_id
    and status = 'active';
  get diagnostics inserted_events = row_count;
  entitlement_revoked := inserted_events > 0;

  return jsonb_build_object(
    'status', 'refunded',
    'eventId', provider_event_id,
    'checkoutSessionId', purchase_session_id,
    'entitlementRevoked', entitlement_revoked
  );
end;
$$;

revoke all on function public.fulfill_stripe_pro_purchase(text, text, text, text, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.refund_stripe_pro_purchase(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_pro_checkout(uuid) from public, anon;
grant execute on function public.reserve_pro_checkout(uuid) to authenticated;
grant execute on function public.fulfill_stripe_pro_purchase(text, text, text, text, uuid, boolean, timestamptz) to service_role;
grant execute on function public.refund_stripe_pro_purchase(text, text, timestamptz) to service_role;
