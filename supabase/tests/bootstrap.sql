create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;

create table auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create publication supabase_realtime;
