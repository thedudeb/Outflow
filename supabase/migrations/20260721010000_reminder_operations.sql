create table public.reminder_worker_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  deployment_commit text not null check (deployment_commit ~ '^[a-f0-9]{40}$'),
  claimed integer not null check (claimed between 0 and 100),
  sent integer not null check (sent between 0 and 100),
  failed integer not null check (failed between 0 and 100),
  completion_errors integer not null check (completion_errors between 0 and 100),
  check (claimed = sent + failed),
  check (completed_at >= started_at - interval '1 minute' and completed_at <= started_at + interval '15 minutes')
);

create index reminder_worker_runs_completed_idx
on public.reminder_worker_runs (completed_at desc);

alter table public.reminder_worker_runs enable row level security;

revoke all on public.reminder_worker_runs from public, anon, authenticated, service_role;
revoke all on sequence public.reminder_worker_runs_id_seq from public, anon, authenticated, service_role;

create or replace function public.record_reminder_worker_run(
  worker_started_at timestamptz,
  worker_deployment_commit text,
  worker_claimed integer,
  worker_sent integer,
  worker_failed integer,
  worker_completion_errors integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_completed_at timestamptz := clock_timestamp();
begin
  if worker_started_at is null
    or worker_started_at < run_completed_at - interval '15 minutes'
    or worker_started_at > run_completed_at + interval '1 minute'
  then
    raise exception 'Reminder worker start time is invalid.' using errcode = '22023';
  end if;
  if worker_deployment_commit is null or worker_deployment_commit !~ '^[a-f0-9]{40}$' then
    raise exception 'Reminder worker deployment commit is invalid.' using errcode = '22023';
  end if;
  if worker_claimed is null
    or worker_sent is null
    or worker_failed is null
    or worker_completion_errors is null
    or worker_claimed not between 0 and 100
    or worker_sent not between 0 and 100
    or worker_failed not between 0 and 100
    or worker_completion_errors not between 0 and 100
    or worker_claimed <> worker_sent + worker_failed
  then
    raise exception 'Reminder worker counters are invalid.' using errcode = '22023';
  end if;

  delete from public.reminder_worker_runs
  where completed_at < run_completed_at - interval '30 days';

  insert into public.reminder_worker_runs (
    started_at,
    completed_at,
    deployment_commit,
    claimed,
    sent,
    failed,
    completion_errors
  ) values (
    worker_started_at,
    run_completed_at,
    worker_deployment_commit,
    worker_claimed,
    worker_sent,
    worker_failed,
    worker_completion_errors
  );
  return true;
end;
$$;

create or replace function public.reminder_operational_health(expected_deployment_commit text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := clock_timestamp();
  latest_run public.reminder_worker_runs;
  recent_run boolean;
  latest_commit_matches boolean;
  runs_1h integer;
  claimed_1h integer;
  sent_1h integer;
  failed_1h integer;
  completion_errors_1h integer;
  exhausted_deliveries integer;
  overdue_retries integer;
  stuck_claims integer;
  suppressions_24h integer;
  alerts jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
begin
  if expected_deployment_commit is null or expected_deployment_commit !~ '^[a-f0-9]{40}$' then
    raise exception 'Expected reminder deployment commit is invalid.' using errcode = '22023';
  end if;

  select * into latest_run
  from public.reminder_worker_runs
  order by completed_at desc, id desc
  limit 1;

  recent_run := latest_run.id is not null and latest_run.completed_at >= checked_at - interval '2 hours';
  latest_commit_matches := latest_run.id is not null and latest_run.deployment_commit = expected_deployment_commit;

  select
    count(*)::integer,
    coalesce(sum(claimed), 0)::integer,
    coalesce(sum(sent), 0)::integer,
    coalesce(sum(failed), 0)::integer,
    coalesce(sum(completion_errors), 0)::integer
  into runs_1h, claimed_1h, sent_1h, failed_1h, completion_errors_1h
  from public.reminder_worker_runs
  where completed_at >= checked_at - interval '1 hour';

  select count(*)::integer into exhausted_deliveries
  from public.notification_deliveries
  where status = 'failed' and attempt_count >= 5;

  select count(*)::integer into overdue_retries
  from public.notification_deliveries
  where status = 'failed'
    and attempt_count < 5
    and next_attempt_at <= checked_at - interval '10 minutes';

  select count(*)::integer into stuck_claims
  from public.notification_deliveries
  where status = 'sending'
    and claimed_at <= checked_at - interval '15 minutes';

  select count(*)::integer into suppressions_24h
  from public.notification_preferences
  where email_suppressed_at >= checked_at - interval '24 hours';

  if not recent_run then alerts := alerts || jsonb_build_array('stale_worker'); end if;
  if recent_run and not latest_commit_matches then alerts := alerts || jsonb_build_array('commit_mismatch'); end if;
  if completion_errors_1h > 0 then alerts := alerts || jsonb_build_array('completion_errors'); end if;
  if exhausted_deliveries > 0 then alerts := alerts || jsonb_build_array('exhausted_deliveries'); end if;
  if stuck_claims > 0 then alerts := alerts || jsonb_build_array('stuck_claims'); end if;
  if overdue_retries >= 5 then alerts := alerts || jsonb_build_array('retry_backlog'); end if;
  if failed_1h >= 10 then alerts := alerts || jsonb_build_array('failure_spike'); end if;
  if suppressions_24h >= 5 then alerts := alerts || jsonb_build_array('suppression_spike'); end if;

  if overdue_retries between 1 and 4 then warnings := warnings || jsonb_build_array('retry_backlog'); end if;
  if failed_1h between 1 and 9 then warnings := warnings || jsonb_build_array('provider_failures'); end if;
  if suppressions_24h between 1 and 4 then warnings := warnings || jsonb_build_array('suppression_growth'); end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'healthy', jsonb_array_length(alerts) = 0,
    'lastRunAt', latest_run.completed_at,
    'recentRun', recent_run,
    'latestCommitMatches', latest_commit_matches,
    'runs1h', runs_1h,
    'claimed1h', claimed_1h,
    'sent1h', sent_1h,
    'failed1h', failed_1h,
    'completionErrors1h', completion_errors_1h,
    'exhaustedDeliveries', exhausted_deliveries,
    'overdueRetries', overdue_retries,
    'stuckClaims', stuck_claims,
    'suppressions24h', suppressions_24h,
    'alerts', alerts,
    'warnings', warnings
  );
end;
$$;

revoke all on function public.record_reminder_worker_run(timestamptz, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.reminder_operational_health(text) from public, anon, authenticated;

grant execute on function public.record_reminder_worker_run(timestamptz, text, integer, integer, integer, integer) to service_role;
grant execute on function public.reminder_operational_health(text) to service_role;
