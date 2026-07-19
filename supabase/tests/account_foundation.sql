\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'stranger@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.migrate_guest_workspace($workspace$
{
  "schemaVersion": 1,
  "activeLedgerId": "personal-ledger",
  "ledgers": [
    {
      "ledger": {
        "id": "personal-ledger",
        "name": "Personal",
        "kind": "personal",
        "storage": "local",
        "createdAt": "2026-07-19T10:00:00.000Z",
        "updatedAt": "2026-07-19T11:00:00.000Z"
      },
      "subscriptions": [
        {
          "id": "netflix",
          "name": "Netflix",
          "amount": 15.49,
          "currency": "USD",
          "cycle": "monthly",
          "nextBillingDate": "2026-08-24",
          "category": "Streaming",
          "tags": ["personal", "video"],
          "color": "#ef4444",
          "trialEndDate": "",
          "reminderLeadDays": [7, 1],
          "paused": false,
          "revision": 2,
          "updatedAt": "2026-07-19T11:00:00.000Z",
          "createdBy": "Local guest",
          "updatedBy": "Local guest"
        }
      ]
    }
  ]
}
$workspace$::jsonb) as first_receipt;

select public.migrate_guest_workspace($workspace$
{
  "schemaVersion": 1,
  "activeLedgerId": "personal-ledger",
  "ledgers": [
    {
      "ledger": {
        "id": "personal-ledger", "name": "Personal", "kind": "personal", "storage": "local",
        "createdAt": "2026-07-19T10:00:00.000Z", "updatedAt": "2026-07-19T11:00:00.000Z"
      },
      "subscriptions": [
        {
          "id": "netflix", "name": "Netflix", "amount": 15.49, "currency": "USD", "cycle": "monthly",
          "nextBillingDate": "2026-08-24", "category": "Streaming", "tags": ["personal", "video"],
          "color": "#ef4444", "trialEndDate": "", "reminderLeadDays": [7, 1], "paused": false,
          "revision": 2, "updatedAt": "2026-07-19T11:00:00.000Z", "createdBy": "Local guest", "updatedBy": "Local guest"
        }
      ]
    }
  ]
}
$workspace$::jsonb) as second_receipt;

do $$
begin
  if (select count(*) from public.ledgers) <> 1 then raise exception 'owner should see one ledger'; end if;
  if (select count(*) from public.subscriptions) <> 1 then raise exception 'owner should see one subscription'; end if;
  if (select count(*) from public.migration_receipts) <> 1 then raise exception 'idempotent migration created a second receipt'; end if;
end;
$$;

delete from public.ledger_members
where ledger_id = 'personal-ledger' and user_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  if (select count(*) from public.ledger_members where ledger_id = 'personal-ledger') <> 1 then
    raise exception 'owner removed their required membership';
  end if;
end;
$$;

do $$
begin
  update public.subscriptions
  set created_by = '22222222-2222-4222-8222-222222222222'
  where ledger_id = 'personal-ledger' and id = 'netflix';
  raise exception 'immutable attribution update unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  insert into public.ledgers (id, name, kind, owner_id)
  values ('second-personal', 'Second personal', 'personal', '11111111-1111-4111-8111-111111111111');
  raise exception 'second personal ledger unexpectedly succeeded';
exception
  when unique_violation then null;
end;
$$;

do $$
begin
  perform public.migrate_guest_workspace(
    '{"schemaVersion":1,"activeLedgerId":"duplicate","ledgers":[{"ledger":{"id":"duplicate","name":"One","kind":"personal"},"subscriptions":[]},{"ledger":{"id":"duplicate","name":"Two","kind":"team"},"subscriptions":[]}]}'::jsonb
  );
  raise exception 'duplicate ledger migration unexpectedly succeeded';
exception
  when others then
    if sqlerrm = 'duplicate ledger migration unexpectedly succeeded' then raise; end if;
end;
$$;

do $$
begin
  insert into public.entitlements (user_id, product, status, provider, provider_reference, purchased_at)
  values ('11111111-1111-4111-8111-111111111111', 'outflow_pro_lifetime', 'active', 'manual', 'forbidden', now());
  raise exception 'client entitlement write unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.migrate_guest_workspace(
    '{"schemaVersion":1,"activeLedgerId":"personal-ledger","ledgers":[{"ledger":{"id":"personal-ledger","name":"Personal","kind":"personal"},"subscriptions":[]},{"ledger":{"id":"household-ledger","name":"Home","kind":"household"},"subscriptions":[]}]}'::jsonb
  );
  raise exception 'shared-ledger migration without Pro unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  insert into public.ledgers (id, name, kind, owner_id)
  values ('team-ledger', 'Studio', 'team', '11111111-1111-4111-8111-111111111111');
  raise exception 'team ledger creation without Pro unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
insert into public.entitlements (user_id, product, status, provider, provider_reference, purchased_at)
values ('11111111-1111-4111-8111-111111111111', 'outflow_pro_lifetime', 'active', 'manual', 'test-pro', now());
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

insert into public.ledgers (id, name, kind, owner_id)
values ('team-ledger', 'Studio', 'team', '11111111-1111-4111-8111-111111111111');
insert into public.ledger_members (ledger_id, user_id, role)
values ('team-ledger', '11111111-1111-4111-8111-111111111111', 'owner');

do $$
begin
  if not public.has_lifetime_pro() then raise exception 'active Pro entitlement was not resolved'; end if;
  if (select count(*) from public.ledgers) <> 2 then raise exception 'Pro team ledger was not created'; end if;
end;
$$;

select public.replace_ledger_snapshot(
  'team-ledger',
  0,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  $snapshot$
  [{
    "id":"figma","name":"Figma","amount":12,"currency":"USD","cycle":"monthly",
    "nextBillingDate":"2026-08-19","category":"Design","tags":["work"],"color":"#8b5cf6",
    "trialEndDate":"","reminderLeadDays":[7,1],"paused":false,
    "revision":0,"updatedAt":"2026-07-19T18:00:00.000Z","createdBy":"Owner","updatedBy":"Owner"
  }]
  $snapshot$::jsonb
) as first_sync;

select public.replace_ledger_snapshot(
  'team-ledger',
  0,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[]'::jsonb
) as idempotent_sync;

do $$
begin
  if (select revision from public.ledgers where id = 'team-ledger') <> 1 then raise exception 'ledger revision did not advance once'; end if;
  if (select count(*) from public.subscriptions where ledger_id = 'team-ledger') <> 1 then raise exception 'synchronized subscription was not stored'; end if;
  if (select count(*) from public.ledger_sync_operations where ledger_id = 'team-ledger') <> 1 then raise exception 'idempotent sync created another operation'; end if;
end;
$$;

select public.replace_ledger_snapshot(
  'team-ledger',
  0,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  $snapshot$
  [{
    "id":"figma","name":"Figma","amount":20,"currency":"USD","cycle":"monthly",
    "nextBillingDate":"2026-08-19","category":"Design","tags":["work"],"color":"#8b5cf6",
    "trialEndDate":"","reminderLeadDays":[7,1],"paused":false,
    "revision":0,"updatedAt":"2026-07-19T18:05:00.000Z","createdBy":"Owner","updatedBy":"Owner"
  }]
  $snapshot$::jsonb
) as conflicting_sync;

do $$
begin
  if (select amount from public.subscriptions where ledger_id = 'team-ledger' and id = 'figma') <> 12 then
    raise exception 'stale snapshot overwrote the cloud subscription';
  end if;
  if (select result ->> 'status' from public.ledger_sync_operations where operation_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'conflict' then
    raise exception 'stale snapshot did not record a conflict';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
begin
  if (select count(*) from public.ledgers) <> 0 then raise exception 'RLS exposed another user ledger'; end if;
  if (select count(*) from public.subscriptions) <> 0 then raise exception 'RLS exposed another user subscription'; end if;
  if (select count(*) from public.migration_receipts) <> 0 then raise exception 'RLS exposed another user receipt'; end if;
  if (select count(*) from public.ledger_sync_operations) <> 0 then raise exception 'RLS exposed another user sync operation'; end if;
end;
$$;

do $$
begin
  perform public.replace_ledger_snapshot('team-ledger', 1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '[]'::jsonb);
  raise exception 'non-member synchronized another ledger';
exception
  when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
begin
  if (public.can_invite_to_ledger('team-ledger') ->> 'ledgerName') <> 'Studio' then
    raise exception 'Pro owner invitation permission was not resolved';
  end if;
end;
$$;

do $$
begin
  insert into public.ledger_invitations (
    ledger_id, email, role, token_hash, invited_by, expires_at
  ) values (
    'team-ledger', 'stranger@example.com', 'editor', repeat('a', 64),
    '11111111-1111-4111-8111-111111111111', now() + interval '7 days'
  );
  raise exception 'browser invitation insertion unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
insert into public.ledger_invitations (
  ledger_id, email, role, token_hash, invited_by, expires_at
) values (
  'team-ledger',
  'stranger@example.com',
  'editor',
  encode(extensions.digest(convert_to('outflow-invitation-token-12345678901234567890', 'UTF8'), 'sha256'), 'hex'),
  '11111111-1111-4111-8111-111111111111',
  now() + interval '7 days'
);
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
begin
  perform token_hash from public.ledger_invitations where ledger_id = 'team-ledger';
  raise exception 'invitation token hash unexpectedly exposed';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.accept_ledger_invitation('outflow-invitation-token-12345678901234567890');
  raise exception 'wrong account accepted an invitation';
exception
  when invalid_parameter_value then null;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.accept_ledger_invitation('outflow-invitation-token-12345678901234567890') as accepted_invitation;

do $$
begin
  if (select role from public.ledger_members where ledger_id = 'team-ledger' and user_id = auth.uid()) <> 'editor' then
    raise exception 'invited member did not receive editor access';
  end if;
  if (select count(*) from public.ledgers) <> 1 then raise exception 'invited member cannot see shared ledger'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'shared member profiles are not visible'; end if;
end;
$$;

select public.replace_ledger_snapshot(
  'team-ledger',
  1,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  $snapshot$
  [{
    "id":"figma","name":"Figma","amount":13,"currency":"USD","cycle":"monthly",
    "nextBillingDate":"2026-08-19","category":"Design","tags":["work","shared"],"color":"#8b5cf6",
    "trialEndDate":"","reminderLeadDays":[7],"paused":false,
    "revision":1,"updatedAt":"2026-07-19T18:10:00.000Z","createdBy":"Owner","updatedBy":"Editor"
  }]
  $snapshot$::jsonb
) as editor_sync;

do $$
begin
  if (select revision from public.ledgers where id = 'team-ledger') <> 2 then raise exception 'editor sync did not advance ledger revision'; end if;
  if (select amount from public.subscriptions where ledger_id = 'team-ledger' and id = 'figma') <> 13 then raise exception 'editor sync was not applied'; end if;
  if (select updated_by from public.subscriptions where ledger_id = 'team-ledger' and id = 'figma') <> auth.uid() then
    raise exception 'editor sync attribution is incorrect';
  end if;
end;
$$;

do $$
begin
  perform public.rename_cloud_ledger(
    'team-ledger', 2, '24681357-2468-4468-8468-246813579024', 'Editor rename'
  );
  raise exception 'editor renamed a shared ledger';
exception
  when insufficient_privilege then null;
end;
$$;

update public.ledger_members
set role = 'viewer'
where ledger_id = 'team-ledger' and user_id = auth.uid();

do $$
begin
  if (select role from public.ledger_members where ledger_id = 'team-ledger' and user_id = auth.uid()) <> 'editor' then
    raise exception 'member changed their own role';
  end if;
end;
$$;

do $$
begin
  perform public.accept_ledger_invitation('outflow-invitation-token-12345678901234567890');
  raise exception 'accepted invitation token was reused';
exception
  when invalid_parameter_value then null;
end;
$$;

reset role;
insert into public.ledger_invitations (
  ledger_id, email, role, token_hash, invited_by, expires_at, created_at
) values (
  'team-ledger',
  'stranger@example.com',
  'viewer',
  encode(extensions.digest(convert_to('outflow-expired-token-1234567890123456789012', 'UTF8'), 'sha256'), 'hex'),
  '11111111-1111-4111-8111-111111111111',
  now() - interval '1 day',
  now() - interval '2 days'
);
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
begin
  perform public.accept_ledger_invitation('outflow-expired-token-1234567890123456789012');
  raise exception 'expired invitation token was accepted';
exception
  when invalid_parameter_value then null;
end;
$$;

reset role;
update public.entitlements
set status = 'revoked', revoked_at = now()
where user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
begin
  if (select count(*) from public.ledgers) <> 1 then
    raise exception 'existing shared access was removed with Pro entitlement';
  end if;
end;
$$;

do $$
begin
  perform public.replace_ledger_snapshot('team-ledger', 2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '[]'::jsonb);
  raise exception 'shared ledger synchronized after owner Pro revocation';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
update public.entitlements
set status = 'active', revoked_at = null
where user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

update public.ledger_members
set role = 'viewer'
where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222';

do $$
begin
  if (select role from public.ledger_members where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222') <> 'viewer' then
    raise exception 'owner could not change collaborator role';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
begin
  perform public.replace_ledger_snapshot('team-ledger', 2, 'ffffffff-ffff-4fff-8fff-ffffffffffff', '[]'::jsonb);
  raise exception 'viewer synchronized a shared ledger';
exception
  when insufficient_privilege then null;
end;
$$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.replace_ledger_snapshot(
  'team-ledger',
  2,
  '12345678-1234-4234-8234-123456789012',
  '[]'::jsonb
) as owner_delete_sync;

do $$
begin
  if (select revision from public.ledgers where id = 'team-ledger') <> 3 then raise exception 'delete sync did not advance ledger revision'; end if;
  if exists (select 1 from public.subscriptions where ledger_id = 'team-ledger') then raise exception 'snapshot deletion was not applied'; end if;
end;
$$;

select public.rename_cloud_ledger(
  'team-ledger',
  3,
  '13572468-1357-4357-8357-135724680135',
  'Studio Ops'
) as owner_rename_sync;

do $$
begin
  if (select name from public.ledgers where id = 'team-ledger') <> 'Studio Ops' then raise exception 'owner rename was not applied'; end if;
  if (select revision from public.ledgers where id = 'team-ledger') <> 4 then raise exception 'owner rename did not advance ledger revision'; end if;
end;
$$;

do $$
begin
  update public.ledger_members
  set role = 'owner'
  where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222';
  raise exception 'owner promoted another member to owner role';
exception
  when insufficient_privilege then null;
end;
$$;

delete from public.ledger_members
where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222';

do $$
begin
  if exists (
    select 1 from public.ledger_members
    where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222'
  ) then raise exception 'owner could not remove collaborator'; end if;
end;
$$;

reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  if (select count(*) from public.ledgers) <> 0 then raise exception 'account deletion did not cascade ledgers'; end if;
  if (select count(*) from public.subscriptions) <> 0 then raise exception 'account deletion did not cascade subscriptions'; end if;
  if (select count(*) from public.migration_receipts) <> 0 then raise exception 'account deletion did not cascade receipts'; end if;
  if (select count(*) from public.ledger_sync_operations) <> 0 then raise exception 'account deletion did not cascade sync operations'; end if;
end;
$$;
