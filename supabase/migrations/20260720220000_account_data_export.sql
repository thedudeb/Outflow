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
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'product', 'Outflow',
    'schemaVersion', 1,
    'exportedAt', now(),
    'account', jsonb_build_object(
      'id', account.id,
      'email', account.email,
      'displayName', profile.display_name,
      'createdAt', profile.created_at,
      'updatedAt', profile.updated_at
    ),
    'entitlement', (
      select jsonb_build_object(
        'product', entitlement.product,
        'status', entitlement.status,
        'provider', entitlement.provider,
        'purchasedAt', entitlement.purchased_at,
        'revokedAt', entitlement.revoked_at
      )
      from public.entitlements as entitlement
      where entitlement.user_id = caller
        and entitlement.product = 'outflow_pro_lifetime'
    ),
    'notificationPreferences', (
      select jsonb_build_object(
        'emailEnabled', preference.email_enabled,
        'pausedScheduleEnabled', preference.paused_schedule_enabled,
        'timezone', preference.timezone,
        'createdAt', preference.created_at,
        'updatedAt', preference.updated_at
      )
      from public.notification_preferences as preference
      where preference.user_id = caller
    ),
    'ledgers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ledger.id,
          'name', ledger.name,
          'kind', ledger.kind,
          'ownerId', ledger.owner_id,
          'currentRole', membership.role,
          'revision', ledger.revision,
          'createdAt', ledger.created_at,
          'updatedAt', ledger.updated_at,
          'members', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'userId', member.user_id,
                'displayName', member_profile.display_name,
                'role', member.role,
                'joinedAt', member.joined_at
              ) order by member.joined_at, member.user_id
            )
            from public.ledger_members as member
            left join public.profiles as member_profile on member_profile.id = member.user_id
            where member.ledger_id = ledger.id
          ), '[]'::jsonb),
          'pendingInvitations', case
            when ledger.owner_id = caller then coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', invitation.id,
                  'email', invitation.email,
                  'role', invitation.role,
                  'expiresAt', invitation.expires_at,
                  'createdAt', invitation.created_at
                ) order by invitation.created_at, invitation.id
              )
              from public.ledger_invitations as invitation
              where invitation.ledger_id = ledger.id
                and invitation.accepted_at is null
                and invitation.expires_at > now()
            ), '[]'::jsonb)
            else '[]'::jsonb
          end,
          'subscriptions', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', subscription.id,
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
                'createdBy', subscription.created_by,
                'updatedBy', subscription.updated_by,
                'sourceCreatedBy', subscription.source_created_by,
                'sourceUpdatedBy', subscription.source_updated_by,
                'clientUpdatedAt', subscription.client_updated_at,
                'createdAt', subscription.created_at,
                'updatedAt', subscription.updated_at
              ) order by subscription.next_billing_date, subscription.name, subscription.id
            )
            from public.subscriptions as subscription
            where subscription.ledger_id = ledger.id
          ), '[]'::jsonb)
        ) order by ledger.created_at, ledger.id
      )
      from public.ledgers as ledger
      join public.ledger_members as membership
        on membership.ledger_id = ledger.id and membership.user_id = caller
    ), '[]'::jsonb),
    'hostedCalendarFeeds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', feed.id,
          'ledgerId', feed.ledger_id,
          'ledgerName', ledger.name,
          'includePaused', feed.include_paused,
          'createdAt', feed.created_at,
          'updatedAt', feed.updated_at,
          'rotatedAt', feed.rotated_at,
          'lastAccessAt', feed.last_access_at
        ) order by feed.created_at, feed.id
      )
      from public.calendar_feeds as feed
      join public.ledgers as ledger on ledger.id = feed.ledger_id
      where feed.user_id = caller
    ), '[]'::jsonb),
    'emailReminderDeliveries', coalesce((
      select jsonb_agg(
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
          'attemptCount', delivery.attempt_count,
          'sentAt', delivery.sent_at,
          'createdAt', delivery.created_at,
          'updatedAt', delivery.updated_at
        ) order by delivery.scheduled_date, delivery.created_at, delivery.id
      )
      from public.notification_deliveries as delivery
      where delivery.user_id = caller
    ), '[]'::jsonb)
  ) into result
  from auth.users as account
  left join public.profiles as profile on profile.id = account.id
  where account.id = caller;

  if result is null then
    raise exception 'Account data is unavailable.' using errcode = '42501';
  end if;

  return result;
end;
$$;

revoke all on function public.export_account_data() from public, anon;
grant execute on function public.export_account_data() to authenticated;
