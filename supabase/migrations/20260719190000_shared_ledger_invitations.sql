create unique index invitations_one_pending_per_email_idx
on public.ledger_invitations (ledger_id, lower(email))
where accepted_at is null;

create or replace function public.shares_ledger_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ledger_members mine
    join public.ledger_members theirs on theirs.ledger_id = mine.ledger_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = target_user_id
  );
$$;

create policy profiles_select_shared_members on public.profiles for select to authenticated
using (public.shares_ledger_with(id));

drop policy members_insert_owner on public.ledger_members;
create policy members_insert_owner on public.ledger_members for insert to authenticated
with check (
  public.is_ledger_owner(ledger_id)
  and (
    (user_id = (select auth.uid()) and role = 'owner')
    or (
      user_id <> (select auth.uid())
      and role in ('editor', 'viewer')
      and public.has_lifetime_pro()
    )
  )
);

drop policy members_update_owner on public.ledger_members;
create policy members_update_owner on public.ledger_members for update to authenticated
using (public.is_ledger_owner(ledger_id))
with check (
  public.is_ledger_owner(ledger_id)
  and (
    (user_id = (select auth.uid()) and role = 'owner')
    or (
      user_id <> (select auth.uid())
      and role in ('editor', 'viewer')
      and public.has_lifetime_pro()
    )
  )
);

drop policy invitations_insert_owner on public.ledger_invitations;
drop policy invitations_update_owner on public.ledger_invitations;

revoke select, insert, update on public.ledger_invitations from authenticated;
grant select (
  id, ledger_id, email, role, invited_by, expires_at, accepted_at, created_at
) on public.ledger_invitations to authenticated;

create or replace function public.can_invite_to_ledger(target_ledger_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target public.ledgers%rowtype;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into target
  from public.ledgers
  where id = target_ledger_id and owner_id = caller;

  if not found or target.kind = 'personal' or not public.has_lifetime_pro() then
    raise exception 'A Pro ledger owner is required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ledgerId', target.id,
    'ledgerName', target.name,
    'ledgerKind', target.kind
  );
end;
$$;

create or replace function public.accept_ledger_invitation(invitation_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  invitation public.ledger_invitations%rowtype;
  target public.ledgers%rowtype;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if invitation_token is null or char_length(invitation_token) not between 40 and 128 then
    raise exception 'This invitation is invalid or expired.' using errcode = '22023';
  end if;

  select lower(email) into caller_email from auth.users where id = caller;
  if caller_email is null then
    raise exception 'This account has no verified invitation email.' using errcode = '42501';
  end if;

  select * into invitation
  from public.ledger_invitations
  where token_hash = encode(extensions.digest(convert_to(invitation_token, 'UTF8'), 'sha256'), 'hex')
    and accepted_at is null
    and expires_at > now()
    and lower(email) = caller_email
  for update;

  if not found then
    raise exception 'This invitation is invalid or expired.' using errcode = '22023';
  end if;

  select * into target from public.ledgers where id = invitation.ledger_id;
  if not found or target.kind = 'personal' or not exists (
    select 1 from public.entitlements
    where user_id = target.owner_id
      and product = 'outflow_pro_lifetime'
      and status = 'active'
  ) then
    raise exception 'This invitation is no longer available.' using errcode = '42501';
  end if;

  insert into public.ledger_members (ledger_id, user_id, role)
  values (invitation.ledger_id, caller, invitation.role)
  on conflict (ledger_id, user_id) do update
  set role = case
    when public.ledger_members.role = 'owner' then 'owner'
    else excluded.role
  end;

  update public.ledger_invitations
  set accepted_at = now()
  where id = invitation.id;

  return jsonb_build_object(
    'ledgerId', target.id,
    'ledgerName', target.name,
    'ledgerKind', target.kind,
    'role', invitation.role
  );
end;
$$;

revoke all on function public.shares_ledger_with(uuid) from public, anon;
revoke all on function public.can_invite_to_ledger(text) from public, anon;
revoke all on function public.accept_ledger_invitation(text) from public, anon;
grant execute on function public.shares_ledger_with(uuid) to authenticated;
grant execute on function public.can_invite_to_ledger(text) to authenticated;
grant execute on function public.accept_ledger_invitation(text) to authenticated;
