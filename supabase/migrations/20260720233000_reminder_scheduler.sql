create table public.reminder_scheduler_requests (
  id uuid primary key default gen_random_uuid(),
  request_id bigint not null,
  queued_at timestamptz not null default now()
);

create index reminder_scheduler_requests_queued_idx
on public.reminder_scheduler_requests (queued_at desc);

alter table public.reminder_scheduler_requests enable row level security;
revoke all on public.reminder_scheduler_requests from public, anon, authenticated, service_role;

create or replace function public.invoke_due_reminder_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder_endpoint text;
  cron_secret text;
  endpoint_entries integer := 0;
  cron_secret_entries integer := 0;
  request_id bigint;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    raise exception 'The reminder scheduler requires pg_net.' using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception 'The reminder scheduler requires Supabase Vault.' using errcode = '55000';
  end if;

  execute $query$
    select count(*), max(decrypted_secret)
    from vault.decrypted_secrets
    where name = $1
  $query$ into endpoint_entries, reminder_endpoint using 'outflow_reminder_endpoint';
  execute $query$
    select count(*), max(decrypted_secret)
    from vault.decrypted_secrets
    where name = $1
  $query$ into cron_secret_entries, cron_secret using 'outflow_cron_secret';

  if endpoint_entries <> 1
    or reminder_endpoint is null
    or reminder_endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/send-due-reminders$' then
    raise exception 'The reminder endpoint Vault entry is invalid.' using errcode = '22023';
  end if;
  if cron_secret_entries <> 1
    or cron_secret is null
    or char_length(cron_secret) not between 32 and 512
    or cron_secret ~ '[[:space:]]'
    or (
      select count(distinct character)
      from regexp_split_to_table(cron_secret, '') as characters(character)
    ) < 10 then
    raise exception 'The reminder cron secret Vault entry is invalid.' using errcode = '22023';
  end if;

  execute $query$
    select net.http_post(
      url := $1,
      body := $2,
      headers := $3,
      timeout_milliseconds := 10000
    )
  $query$
  into request_id
  using
    reminder_endpoint,
    jsonb_build_object('batchSize', 100),
    jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    );

  if request_id is null then
    raise exception 'The reminder worker request was not queued.' using errcode = '55000';
  end if;
  delete from public.reminder_scheduler_requests
  where queued_at < now() - interval '7 days';
  insert into public.reminder_scheduler_requests (request_id)
  values (request_id);
  return request_id;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    raise exception 'The reminder scheduler requires configured pg_net and Vault extensions.' using errcode = '55000';
end;
$$;

create or replace function public.reminder_scheduler_status(expected_project_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cron_ready boolean := exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  );
  network_ready boolean := exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_net'
  );
  vault_ready boolean := pg_catalog.to_regclass('vault.decrypted_secrets') is not null;
  endpoint_configured boolean := false;
  cron_secret_configured boolean := false;
  matching_jobs integer := 0;
  job_id bigint;
  job_schedule text;
  job_active boolean := false;
  job_command_matches boolean := false;
  last_run_status text;
  last_run_at timestamptz;
  last_success_at timestamptz;
  recent_success boolean := false;
  worker_request_id bigint;
  worker_request_status integer;
  worker_request_at timestamptz;
  worker_reached boolean := false;
  job_configured boolean := false;
begin
  if expected_project_ref is null or expected_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'The expected scheduler project is invalid.' using errcode = '22023';
  end if;

  if vault_ready then
    execute $query$
      select
        count(*) = 2 and count(*) filter (
          where name = 'outflow_reminder_endpoint'
            and decrypted_secret = 'https://' || $1 || '.supabase.co/functions/v1/send-due-reminders'
        ) = 1,
        count(*) = 2 and count(*) filter (
          where name = 'outflow_cron_secret'
            and char_length(decrypted_secret) between 32 and 512
            and decrypted_secret !~ '[[:space:]]'
            and (
              select count(distinct character)
              from regexp_split_to_table(decrypted_secret, '') as characters(character)
            ) >= 10
        ) = 1
      from vault.decrypted_secrets
      where name in ('outflow_reminder_endpoint', 'outflow_cron_secret')
    $query$ into endpoint_configured, cron_secret_configured using expected_project_ref;
  end if;

  if cron_ready and pg_catalog.to_regclass('cron.job') is not null then
    execute $query$
      select
        count(*),
        max(jobid),
        max(schedule),
        coalesce(bool_and(active), false),
        coalesce(bool_and(command = 'select public.invoke_due_reminder_worker();'), false)
      from cron.job
      where jobname = 'outflow-due-reminders-hourly'
    $query$
    into matching_jobs, job_id, job_schedule, job_active, job_command_matches;

    job_configured := matching_jobs = 1
      and job_schedule = '7 * * * *'
      and job_command_matches;
  end if;

  if job_id is not null and pg_catalog.to_regclass('cron.job_run_details') is not null then
    execute $query$
      select status, start_time
      from cron.job_run_details
      where jobid = $1
      order by start_time desc nulls last, runid desc
      limit 1
    $query$ into last_run_status, last_run_at using job_id;

    execute $query$
      select max(start_time)
      from cron.job_run_details
      where jobid = $1 and status = 'succeeded'
    $query$ into last_success_at using job_id;
    recent_success := last_success_at >= now() - interval '2 hours';
  end if;

  if recent_success then
    select request_id, queued_at
    into worker_request_id, worker_request_at
    from public.reminder_scheduler_requests
    where queued_at >= last_success_at - interval '1 minute'
      and queued_at <= last_success_at + interval '5 minutes'
    order by queued_at desc
    limit 1;
  end if;

  if worker_request_id is not null and pg_catalog.to_regclass('net._http_response') is not null then
    execute $query$
      select status_code, created
      from net._http_response
      where id = $1
      order by created desc
      limit 1
    $query$ into worker_request_status, worker_request_at using worker_request_id;
    worker_reached := worker_request_status = 200;
  end if;

  return jsonb_build_object(
    'cronReady', cron_ready,
    'networkReady', network_ready,
    'vaultReady', vault_ready,
    'endpointConfigured', endpoint_configured,
    'cronSecretConfigured', cron_secret_configured,
    'jobConfigured', job_configured,
    'jobActive', job_active,
    'schedule', case when matching_jobs = 1 then job_schedule else null end,
    'lastRunStatus', last_run_status,
    'lastRunAt', last_run_at,
    'lastSuccessAt', last_success_at,
    'recentSuccess', recent_success,
    'workerRequestStatus', worker_request_status,
    'workerRequestAt', worker_request_at,
    'workerReached', worker_reached,
    'healthy', cron_ready
      and network_ready
      and vault_ready
      and endpoint_configured
      and cron_secret_configured
      and job_configured
      and job_active
      and recent_success
      and worker_reached
  );
exception
  when undefined_table or undefined_column or invalid_schema_name then
    return jsonb_build_object(
      'cronReady', cron_ready,
      'networkReady', network_ready,
      'vaultReady', vault_ready,
      'endpointConfigured', false,
      'cronSecretConfigured', false,
      'jobConfigured', false,
      'jobActive', false,
      'schedule', null,
      'lastRunStatus', null,
      'lastRunAt', null,
      'lastSuccessAt', null,
      'recentSuccess', false,
      'workerRequestStatus', null,
      'workerRequestAt', null,
      'workerReached', false,
      'healthy', false
    );
end;
$$;

revoke all on function public.invoke_due_reminder_worker() from public, anon, authenticated, service_role;
revoke all on function public.reminder_scheduler_status(text) from public, anon, authenticated;
grant execute on function public.reminder_scheduler_status(text) to service_role;
