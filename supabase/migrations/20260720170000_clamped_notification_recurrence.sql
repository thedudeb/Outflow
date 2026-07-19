create or replace function public.advance_notification_date(
  base_date date,
  billing_cycle text,
  not_before date
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate date := base_date;
  anchor_day integer := extract(day from base_date)::integer;
  anchor_month integer := extract(month from base_date)::integer;
  target_period date;
  period_end date;
  advances integer := 0;
begin
  if billing_cycle not in ('weekly', 'monthly', 'yearly') then
    raise exception 'Billing cycle is invalid.';
  end if;

  while candidate < not_before and advances < 50000 loop
    if billing_cycle = 'weekly' then
      candidate := candidate + 7;
    else
      target_period := case billing_cycle
        when 'monthly' then (pg_catalog.date_trunc('month', candidate) + interval '1 month')::date
        when 'yearly' then pg_catalog.make_date(extract(year from candidate)::integer + 1, anchor_month, 1)
      end;
      period_end := (target_period + interval '1 month' - interval '1 day')::date;
      candidate := target_period + least(anchor_day, extract(day from period_end)::integer) - 1;
    end if;
    advances := advances + 1;
  end loop;

  if candidate < not_before then raise exception 'Billing date could not be advanced safely.'; end if;
  return candidate;
end;
$$;

revoke all on function public.advance_notification_date(date, text, date) from public, anon, authenticated;
