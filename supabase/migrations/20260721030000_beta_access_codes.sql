create table public.beta_access_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 60),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  code_suffix text not null check (code_suffix ~ '^[A-F0-9]{5}$'),
  max_redemptions smallint not null check (max_redemptions between 1 and 20),
  expires_at timestamptz,
  disabled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

create table public.beta_access_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.beta_access_codes(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create unique index beta_access_redemptions_user_idx
on public.beta_access_redemptions (user_id)
where user_id is not null;

create index beta_access_redemptions_code_idx
on public.beta_access_redemptions (code_id, redeemed_at);

create table public.beta_access_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index beta_access_attempts_user_time_idx
on public.beta_access_attempts (user_id, attempted_at desc);

alter table public.beta_access_codes enable row level security;
alter table public.beta_access_redemptions enable row level security;
alter table public.beta_access_attempts enable row level security;

create trigger beta_access_codes_touch_updated_at before update on public.beta_access_codes
for each row execute function public.touch_updated_at();

revoke all on table public.beta_access_codes, public.beta_access_redemptions, public.beta_access_attempts
from public, anon, authenticated, service_role;
revoke all on sequence public.beta_access_attempts_id_seq
from public, anon, authenticated, service_role;

create or replace function public.create_beta_access_code(
  requested_label text,
  requested_max_redemptions integer default 20,
  requested_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_label text := regexp_replace(trim(coalesce(requested_label, '')), '\s+', ' ', 'g');
  raw_secret text;
  display_code text;
  normalized_code text;
  created public.beta_access_codes;
begin
  if not public.is_outflow_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if char_length(normalized_label) not between 1 and 60 then
    raise exception 'Code label must contain between 1 and 60 characters.' using errcode = '22023';
  end if;
  if requested_max_redemptions is null or requested_max_redemptions not between 1 and 20 then
    raise exception 'Beta codes may allow between 1 and 20 accounts.' using errcode = '22023';
  end if;
  if requested_expires_at is not null and requested_expires_at <= now() + interval '5 minutes' then
    raise exception 'Code expiry must be at least five minutes in the future.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('outflow-beta-code-inventory', 0));
  if (select count(*) from public.beta_access_codes) >= 100 then
    raise exception 'Beta code inventory limit reached.' using errcode = '54000';
  end if;

  loop
    raw_secret := upper(encode(extensions.gen_random_bytes(10), 'hex'));
    display_code := 'OUTFLOW-' || substr(raw_secret, 1, 5) || '-' || substr(raw_secret, 6, 5)
      || '-' || substr(raw_secret, 11, 5) || '-' || substr(raw_secret, 16, 5);
    normalized_code := 'OUTFLOW' || raw_secret;
    begin
      insert into public.beta_access_codes (
        label, code_hash, code_suffix, max_redemptions, expires_at, created_by
      ) values (
        normalized_label,
        encode(extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'), 'hex'),
        right(raw_secret, 5),
        requested_max_redemptions,
        requested_expires_at,
        caller
      ) returning * into created;
      exit;
    exception
      when unique_violation then null;
    end;
  end loop;

  return jsonb_build_object(
    'schemaVersion', 1,
    'code', display_code,
    'id', created.id,
    'label', created.label,
    'codeSuffix', created.code_suffix,
    'maxRedemptions', created.max_redemptions,
    'redemptionCount', 0,
    'remaining', created.max_redemptions,
    'expiresAt', created.expires_at,
    'disabledAt', created.disabled_at,
    'createdAt', created.created_at
  );
end;
$$;

create or replace function public.redeem_beta_access_code(access_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_code text;
  candidate public.beta_access_codes;
  redemption_id uuid := gen_random_uuid();
  used_count integer;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 0));
  delete from public.beta_access_attempts
  where user_id = caller and attempted_at < now() - interval '24 hours';

  if (
    select count(*) from public.beta_access_attempts
    where user_id = caller and attempted_at >= now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('schemaVersion', 1, 'status', 'rate_limited');
  end if;

  insert into public.beta_access_attempts (user_id) values (caller);

  if exists (
    select 1 from public.beta_access_redemptions where user_id = caller
  ) then
    return jsonb_build_object('schemaVersion', 1, 'status', 'already_redeemed');
  end if;

  if exists (
    select 1 from public.entitlements
    where user_id = caller and product = 'outflow_pro_lifetime' and status = 'active'
  ) then
    return jsonb_build_object('schemaVersion', 1, 'status', 'already_pro');
  end if;

  if access_code is null or char_length(access_code) not between 4 and 64 then
    return jsonb_build_object('schemaVersion', 1, 'status', 'invalid');
  end if;
  normalized_code := regexp_replace(upper(trim(access_code)), '[^A-Z0-9]', '', 'g');
  if char_length(normalized_code) <> 27 or normalized_code !~ '^OUTFLOW[A-F0-9]{20}$' then
    return jsonb_build_object('schemaVersion', 1, 'status', 'invalid');
  end if;

  select * into candidate
  from public.beta_access_codes
  where code_hash = encode(extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'), 'hex')
  for update;

  if not found
    or candidate.disabled_at is not null
    or (candidate.expires_at is not null and candidate.expires_at <= now())
  then
    return jsonb_build_object('schemaVersion', 1, 'status', 'invalid');
  end if;

  select count(*) into used_count
  from public.beta_access_redemptions
  where code_id = candidate.id;
  if used_count >= candidate.max_redemptions then
    return jsonb_build_object('schemaVersion', 1, 'status', 'invalid');
  end if;

  insert into public.beta_access_redemptions (id, code_id, user_id)
  values (redemption_id, candidate.id, caller);

  insert into public.entitlements (
    user_id, product, status, provider, provider_reference, purchased_at, revoked_at
  ) values (
    caller, 'outflow_pro_lifetime', 'active', 'manual', 'beta_access:' || redemption_id, now(), null
  )
  on conflict (user_id, product) do update set
    status = 'active',
    provider = 'manual',
    provider_reference = excluded.provider_reference,
    purchased_at = excluded.purchased_at,
    revoked_at = null;

  return jsonb_build_object(
    'schemaVersion', 1,
    'status', 'redeemed',
    'label', candidate.label,
    'redeemedAt', now()
  );
end;
$$;

create or replace function public.read_beta_access_codes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_outflow_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
      'schemaVersion', 1,
      'codes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', code.id,
          'label', code.label,
          'codeSuffix', code.code_suffix,
          'maxRedemptions', code.max_redemptions,
          'redemptionCount', (select count(*) from public.beta_access_redemptions used where used.code_id = code.id),
          'remaining', greatest(code.max_redemptions - (select count(*) from public.beta_access_redemptions used where used.code_id = code.id), 0),
          'expiresAt', code.expires_at,
          'disabledAt', code.disabled_at,
          'createdAt', code.created_at,
          'redemptions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'userId', redemption.user_id,
              'email', account.email,
              'displayName', profile.display_name,
              'redeemedAt', redemption.redeemed_at
            ) order by redemption.redeemed_at desc)
            from public.beta_access_redemptions redemption
            left join auth.users account on account.id = redemption.user_id
            left join public.profiles profile on profile.id = redemption.user_id
            where redemption.code_id = code.id
          ), '[]'::jsonb)
        ) order by code.created_at desc)
        from public.beta_access_codes code
      ), '[]'::jsonb)
    );
end;
$$;

create or replace function public.set_beta_access_code_disabled(
  target_code_id uuid,
  requested_disabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.beta_access_codes;
begin
  if not public.is_outflow_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if target_code_id is null or requested_disabled is null then
    raise exception 'Code and state are required.' using errcode = '22023';
  end if;

  update public.beta_access_codes
  set disabled_at = case when requested_disabled then coalesce(disabled_at, now()) else null end
  where id = target_code_id
  returning * into updated;
  if not found then raise exception 'Beta code was not found.' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'id', updated.id,
    'disabledAt', updated.disabled_at
  );
end;
$$;

revoke all on function public.create_beta_access_code(text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.redeem_beta_access_code(text) from public, anon, authenticated, service_role;
revoke all on function public.read_beta_access_codes() from public, anon, authenticated, service_role;
revoke all on function public.set_beta_access_code_disabled(uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.create_beta_access_code(text, integer, timestamptz) to authenticated;
grant execute on function public.redeem_beta_access_code(text) to authenticated;
grant execute on function public.read_beta_access_codes() to authenticated;
grant execute on function public.set_beta_access_code_disabled(uuid, boolean) to authenticated;
