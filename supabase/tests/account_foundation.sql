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

do $$
declare
  first_reservation jsonb;
  replay_reservation jsonb;
  reservation_index integer;
begin
  first_reservation := public.reserve_pro_checkout('abcdefab-cdef-4abc-8def-abcdefabcdef');
  replay_reservation := public.reserve_pro_checkout('abcdefab-cdef-4abc-8def-abcdefabcdef');
  if first_reservation ->> 'status' <> 'reserved' then raise exception 'checkout request was not reserved'; end if;
  if replay_reservation ->> 'status' <> 'replay' then raise exception 'checkout request replay was not idempotent'; end if;
  for reservation_index in 1..9 loop
    perform public.reserve_pro_checkout(gen_random_uuid());
  end loop;
  begin
    perform public.reserve_pro_checkout(gen_random_uuid());
    raise exception 'checkout request limit was not enforced';
  exception
    when program_limit_exceeded then null;
  end;
end;
$$;

do $$
begin
  perform public.fulfill_stripe_pro_purchase(
    'evt_clientblocked',
    'checkout.session.completed',
    'cs_test_clientblocked',
    'pi_clientblocked',
    auth.uid(),
    false,
    now()
  );
  raise exception 'authenticated client fulfilled its own entitlement';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform count(*) from public.stripe_purchases;
  raise exception 'authenticated client read server-only purchase records';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
set role service_role;

select public.fulfill_stripe_pro_purchase(
  'evt_checkoutpaidone',
  'checkout.session.completed',
  'cs_test_outflowone',
  'pi_outflowone',
  '11111111-1111-4111-8111-111111111111',
  false,
  now() - interval '90 minutes'
) as first_stripe_purchase;

select public.fulfill_stripe_pro_purchase(
  'evt_checkoutpaidone',
  'checkout.session.completed',
  'cs_test_ignoredduplicate',
  'pi_ignoredduplicate',
  '22222222-2222-4222-8222-222222222222',
  false,
  now() - interval '89 minutes'
) as duplicate_stripe_event;

reset role;

do $$
begin
  if (select count(*) from public.stripe_purchases where user_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Stripe fulfillment did not create exactly one purchase';
  end if;
  if (select provider from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111') <> 'stripe' then
    raise exception 'Stripe fulfillment did not replace the server entitlement source';
  end if;
  if (select status from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111') <> 'active' then
    raise exception 'Stripe fulfillment did not activate Pro';
  end if;
  if exists (select 1 from public.stripe_purchases where checkout_session_id = 'cs_test_ignoredduplicate') then
    raise exception 'duplicate Stripe event was processed twice';
  end if;
end;
$$;

set role service_role;

select public.refund_stripe_pro_purchase(
  'evt_refundone',
  'pi_outflowone',
  now() - interval '60 minutes'
) as stripe_refund;

select public.refund_stripe_pro_purchase(
  'evt_refundone',
  'pi_outflowone',
  now() - interval '59 minutes'
) as duplicate_stripe_refund;

select public.fulfill_stripe_pro_purchase(
  'evt_latepaymentone',
  'checkout.session.async_payment_succeeded',
  'cs_test_outflowone',
  'pi_outflowone',
  '11111111-1111-4111-8111-111111111111',
  false,
  now() - interval '90 minutes'
) as late_payment_after_refund;

reset role;

do $$
begin
  if (select status from public.stripe_purchases where checkout_session_id = 'cs_test_outflowone') <> 'refunded' then
    raise exception 'full refund did not update the purchase';
  end if;
  if (select status from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111') <> 'refunded' then
    raise exception 'full refund did not revoke the matching entitlement';
  end if;
  if (select result from public.billing_events where event_id = 'evt_latepaymentone') <> 'stale' then
    raise exception 'out-of-order payment event was not marked stale';
  end if;
end;
$$;

set role service_role;

select public.fulfill_stripe_pro_purchase(
  'evt_checkoutpaidtwo',
  'checkout.session.async_payment_succeeded',
  'cs_test_outflowtwo',
  'pi_outflowtwo',
  '11111111-1111-4111-8111-111111111111',
  false,
  now() - interval '30 minutes'
) as restored_stripe_purchase;

reset role;

do $$
begin
  if (select status from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111') <> 'active' then
    raise exception 'new purchase did not restore Pro after a refund';
  end if;
  if (select provider_reference from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111') <> 'cs_test_outflowtwo' then
    raise exception 'restored entitlement does not reference the latest purchase';
  end if;
  if (select count(*) from public.billing_events) <> 4 then
    raise exception 'billing event idempotency ledger is incorrect';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.save_notification_preferences(true, false, 'UTC') as enabled_email_preferences;

do $$
begin
  if (select count(*) from public.notification_preferences) <> 1 then
    raise exception 'notification preference RLS exposed another account';
  end if;
  if not (select email_enabled from public.notification_preferences where user_id = auth.uid()) then
    raise exception 'Pro email preference was not enabled';
  end if;
  begin
    perform public.save_notification_preferences(true, false, 'Not/A_Timezone');
    raise exception 'invalid notification timezone was accepted';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    update public.notification_preferences set email_enabled = false where user_id = auth.uid();
    raise exception 'browser directly updated notification preferences';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.claim_due_email_notifications(25, gen_random_uuid());
    raise exception 'browser claimed server email deliveries';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.notification_deliveries;
    raise exception 'browser read server email delivery state';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
begin
  perform public.save_notification_preferences(true, false, 'UTC');
  raise exception 'free account enabled Pro email automation';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
insert into public.subscriptions (
  ledger_id, id, name, amount, currency, cycle, next_billing_date, category, tags, color,
  trial_end_date, reminder_lead_days, paused, created_by, updated_by, source_created_by, source_updated_by
) values
  (
    'personal-ledger', 'email-due', 'Linear', 10, 'USD', 'monthly', current_date + 7,
    'Software', array['work'], '#8b5cf6', current_date + 1, array[7, 1], false,
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Owner', 'Owner'
  ),
  (
    'personal-ledger', 'email-paused', 'Paused service', 4, 'USD', 'monthly', current_date + 3,
    'Software', array[]::text[], '#94a3b8', null, array[3], true,
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Owner', 'Owner'
  );

do $$
begin
  if public.advance_notification_date('2024-01-31', 'monthly', '2024-02-01') <> '2024-02-29'::date then
    raise exception 'leap-year month-end notification date did not clamp to February 29';
  end if;
  if public.advance_notification_date('2025-01-31', 'monthly', '2025-02-01') <> '2025-02-28'::date then
    raise exception 'non-leap month-end notification date did not clamp to February 28';
  end if;
  if public.advance_notification_date('2024-01-31', 'monthly', '2024-03-01') <> '2024-03-31'::date then
    raise exception 'monthly notification recurrence lost its original day after clamping';
  end if;
  if public.advance_notification_date('2024-02-29', 'yearly', '2025-01-01') <> '2025-02-28'::date then
    raise exception 'yearly leap-day notification date did not clamp to February 28';
  end if;
  if public.advance_notification_date('2024-02-29', 'yearly', '2026-01-01') <> '2026-02-28'::date then
    raise exception 'yearly notification recurrence lost its leap-day anchor';
  end if;
  if public.advance_notification_date('2026-07-01', 'weekly', '2026-07-16') <> '2026-07-22'::date then
    raise exception 'weekly notification recurrence changed unexpectedly';
  end if;
end;
$$;

set role service_role;
create temporary table first_email_claim as
select * from public.claim_due_email_notifications(25, 'aaaaaaaa-1111-4111-8111-111111111111');

do $$
declare
  charge_delivery uuid;
  trial_delivery uuid;
begin
  if (select count(*) from first_email_claim) <> 2 then
    raise exception 'email worker did not claim one due charge and one due trial';
  end if;
  if exists (select 1 from first_email_claim where subscription_name = 'Paused service') then
    raise exception 'paused subscription was claimed without opt-in';
  end if;
  if (select count(*) from public.claim_due_email_notifications(25, 'bbbbbbbb-2222-4222-8222-222222222222')) <> 0 then
    raise exception 'active email claims were replayed concurrently';
  end if;

  select delivery_id into charge_delivery from first_email_claim where reminder_kind = 'charge';
  select delivery_id into trial_delivery from first_email_claim where reminder_kind = 'trial';
  if public.complete_email_notification(charge_delivery, 'bbbbbbbb-2222-4222-8222-222222222222', true, 'wrong-claim', null) then
    raise exception 'wrong worker completed another worker claim';
  end if;
  if not public.complete_email_notification(charge_delivery, 'aaaaaaaa-1111-4111-8111-111111111111', true, 'resend-charge', null) then
    raise exception 'charge email completion failed';
  end if;
  if not public.complete_email_notification(trial_delivery, 'aaaaaaaa-1111-4111-8111-111111111111', false, null, 'resend_503') then
    raise exception 'trial email failure was not recorded';
  end if;
end;
$$;

reset role;
update public.notification_deliveries
set next_attempt_at = now() - interval '1 minute'
where reminder_kind = 'trial' and status = 'failed';
update public.subscriptions
set name = 'Linear renamed', amount = 20
where ledger_id = 'personal-ledger' and id = 'email-due';

set role service_role;
create temporary table retry_email_claim as
select * from public.claim_due_email_notifications(25, 'cccccccc-3333-4333-8333-333333333333');

do $$
declare
  retry_delivery uuid;
begin
  if (select count(*) from retry_email_claim) <> 1 then
    raise exception 'failed email was not claimed exactly once for retry';
  end if;
  if (select subscription_name from retry_email_claim) <> 'Linear'
    or (select amount from retry_email_claim) <> 10 then
    raise exception 'email retry payload changed with the live subscription';
  end if;
  select delivery_id into retry_delivery from retry_email_claim;
  if not public.complete_email_notification(retry_delivery, 'cccccccc-3333-4333-8333-333333333333', true, 'resend-trial', null) then
    raise exception 'retried email completion failed';
  end if;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.save_notification_preferences(true, true, 'UTC') as enabled_paused_email_preferences;

reset role;
set role service_role;
create temporary table paused_email_claim as
select * from public.claim_due_email_notifications(25, 'dddddddd-4444-4444-8444-444444444444');

do $$
declare
  paused_delivery uuid;
begin
  if (select count(*) from paused_email_claim where subscription_name = 'Paused service') <> 1 then
    raise exception 'paused email opt-in did not create the due reminder';
  end if;
  select delivery_id into paused_delivery from paused_email_claim where subscription_name = 'Paused service';
  if not public.complete_email_notification(paused_delivery, 'dddddddd-4444-4444-8444-444444444444', true, 'resend-paused', null) then
    raise exception 'paused email completion failed';
  end if;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.notification_deliveries where status = 'sent') <> 3 then
    raise exception 'durable email delivery ledger has an unexpected result';
  end if;
  if exists (select 1 from public.notification_deliveries where claim_token is not null or claimed_at is not null) then
    raise exception 'completed email claims retained worker ownership';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
begin
  begin
    perform count(*) from public.calendar_feeds;
    raise exception 'browser read calendar feed token hashes';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.resolve_calendar_feed(repeat('a', 64));
    raise exception 'browser resolved a private calendar token';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

create temporary table first_calendar_feed as
select public.create_or_rotate_calendar_feed('personal-ledger', false) as payload;

do $$
declare
  metadata jsonb;
  plain_token text := (select payload ->> 'token' from first_calendar_feed);
begin
  metadata := public.get_calendar_feed('personal-ledger');
  if char_length(plain_token) <> 43 or plain_token !~ '^[a-zA-Z0-9_-]{43}$' then
    raise exception 'calendar feed token has invalid entropy encoding';
  end if;
  if metadata ->> 'ledgerName' <> 'Personal' or metadata ? 'token' then
    raise exception 'calendar feed metadata is invalid or exposed its token';
  end if;
end;
$$;

reset role;
do $$
declare
  plain_token text := (select payload ->> 'token' from first_calendar_feed);
  stored_hash text;
begin
  select token_hash into stored_hash from public.calendar_feeds where ledger_id = 'personal-ledger';
  if stored_hash = plain_token or stored_hash <> encode(extensions.digest(convert_to(plain_token, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'calendar feed secret was not stored as a one-way hash';
  end if;
end;
$$;

create temporary table calendar_hash_state (name text primary key, hash text not null);
insert into calendar_hash_state (name, hash)
select 'first', encode(extensions.digest(convert_to(payload ->> 'token', 'UTF8'), 'sha256'), 'hex')
from first_calendar_feed;
grant select on calendar_hash_state to service_role;

set role service_role;
create temporary table first_calendar_resolution as
select public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'first')) as payload;

do $$
begin
  if (select payload -> 'ledger' ->> 'name' from first_calendar_resolution) <> 'Personal' then
    raise exception 'calendar feed did not resolve its ledger';
  end if;
  if exists (
    select 1
    from jsonb_array_elements((select payload -> 'subscriptions' from first_calendar_resolution)) as subscription
    where (subscription ->> 'paused')::boolean
  ) then raise exception 'calendar feed included paused schedules without opt-in'; end if;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.set_calendar_feed_options('personal-ledger', true) as included_paused_calendar_feed;

reset role;
set role service_role;
do $$
declare
  resolved jsonb;
begin
  resolved := public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'first'));
  if not exists (
    select 1 from jsonb_array_elements(resolved -> 'subscriptions') as subscription
    where (subscription ->> 'paused')::boolean
  ) then raise exception 'calendar feed paused-schedule opt-in was ignored'; end if;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
create temporary table rotated_calendar_feed as
select public.create_or_rotate_calendar_feed('personal-ledger', true) as payload;

reset role;
insert into calendar_hash_state (name, hash)
select 'rotated', encode(extensions.digest(convert_to(payload ->> 'token', 'UTF8'), 'sha256'), 'hex')
from rotated_calendar_feed;
set role service_role;
do $$
declare
  old_hash text := (select hash from calendar_hash_state where name = 'first');
  new_hash text := (select hash from calendar_hash_state where name = 'rotated');
begin
  if old_hash = new_hash then raise exception 'calendar feed rotation reused its secret'; end if;
  if public.resolve_calendar_feed(old_hash) is not null then raise exception 'calendar feed rotation left the old URL active'; end if;
  if public.resolve_calendar_feed(new_hash) is null then raise exception 'rotated calendar feed URL did not resolve'; end if;
end;
$$;

reset role;
update public.entitlements
set status = 'revoked', revoked_at = now()
where user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
begin
  perform public.create_or_rotate_calendar_feed('personal-ledger', false);
  raise exception 'account without active Pro rotated a calendar feed';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;
set role service_role;
do $$
begin
  if public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'rotated')) is not null then
    raise exception 'calendar feed survived Pro revocation';
  end if;
end;
$$;

reset role;
update public.entitlements
set status = 'active', revoked_at = null
where user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.revoke_calendar_feed('personal-ledger') as revoked_calendar_feed;

reset role;
set role service_role;
do $$
begin
  if public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'rotated')) is not null then
    raise exception 'revoked calendar feed URL still resolved';
  end if;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.create_or_rotate_calendar_feed('personal-ledger', false) as final_calendar_feed;

reset role;
insert into public.ledger_members (ledger_id, user_id, role)
values ('team-ledger', '22222222-2222-4222-8222-222222222222', 'viewer');
insert into public.entitlements (user_id, product, status, provider, provider_reference, purchased_at)
values (
  '22222222-2222-4222-8222-222222222222', 'outflow_pro_lifetime', 'active', 'manual', 'test-calendar-member', now()
);
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
create temporary table member_calendar_feed as
select public.create_or_rotate_calendar_feed('team-ledger', false) as payload;

reset role;
insert into calendar_hash_state (name, hash)
select 'member', encode(extensions.digest(convert_to(payload ->> 'token', 'UTF8'), 'sha256'), 'hex')
from member_calendar_feed;
set role service_role;
do $$
begin
  if public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'member')) is null then
    raise exception 'Pro shared-ledger member calendar feed did not resolve';
  end if;
end;
$$;

reset role;
delete from public.ledger_members
where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222';
insert into public.ledger_members (ledger_id, user_id, role)
values ('team-ledger', '22222222-2222-4222-8222-222222222222', 'viewer');
set role service_role;
do $$
begin
  if public.resolve_calendar_feed((select hash from calendar_hash_state where name = 'member')) is not null then
    raise exception 'membership removal left a calendar URL able to reactivate';
  end if;
end;
$$;

reset role;
delete from public.ledger_members
where ledger_id = 'team-ledger' and user_id = '22222222-2222-4222-8222-222222222222';
delete from public.entitlements
where user_id = '22222222-2222-4222-8222-222222222222' and provider_reference = 'test-calendar-member';

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

set role service_role;
select public.refund_stripe_pro_purchase(
  'evt_refundafterdelete',
  'pi_outflowtwo',
  now()
) as refund_after_account_deletion;
reset role;

do $$
begin
  if (select count(*) from public.ledgers) <> 0 then raise exception 'account deletion did not cascade ledgers'; end if;
  if (select count(*) from public.subscriptions) <> 0 then raise exception 'account deletion did not cascade subscriptions'; end if;
  if (select count(*) from public.migration_receipts) <> 0 then raise exception 'account deletion did not cascade receipts'; end if;
  if (select count(*) from public.ledger_sync_operations) <> 0 then raise exception 'account deletion did not cascade sync operations'; end if;
  if (select count(*) from public.stripe_purchases) <> 2 then raise exception 'account deletion removed de-identified provider purchase records'; end if;
  if exists (select 1 from public.stripe_purchases where user_id is not null) then raise exception 'account deletion retained a purchase-to-user link'; end if;
  if (select count(*) from public.billing_checkout_requests) <> 0 then raise exception 'account deletion did not remove checkout reservations'; end if;
  if (select count(*) from public.notification_preferences) <> 1 then raise exception 'account deletion did not remove its notification preference'; end if;
  if (select count(*) from public.notification_deliveries) <> 0 then raise exception 'account deletion did not remove email delivery history'; end if;
  if (select count(*) from public.calendar_feeds) <> 0 then raise exception 'account deletion did not remove hosted calendar feeds'; end if;
  if (select status from public.stripe_purchases where checkout_session_id = 'cs_test_outflowtwo') <> 'refunded' then raise exception 'post-deletion refund was not reconciled'; end if;
  if (select count(*) from public.billing_events) <> 5 then raise exception 'account deletion removed provider event tombstones'; end if;
end;
$$;
