update public.subscriptions
set next_billing_date = trial_end_date
where trial_end_date is not null
  and next_billing_date < trial_end_date;

alter table public.subscriptions
add constraint subscriptions_trial_charge_order_check
check (trial_end_date is null or next_billing_date >= trial_end_date);
