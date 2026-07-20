create or replace function public.save_account_profile(requested_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_display_name text := nullif(
    pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(requested_display_name, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  saved public.profiles;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if normalized_display_name is not null and (
    char_length(normalized_display_name) > 60
    or normalized_display_name ~ '[[:cntrl:]]'
  ) then
    raise exception 'Display name is invalid.' using errcode = '22023';
  end if;

  insert into public.profiles (id, display_name)
  values (caller, normalized_display_name)
  on conflict (id) do update
  set display_name = excluded.display_name
  returning * into saved;

  return jsonb_build_object(
    'displayName', saved.display_name,
    'updatedAt', saved.updated_at
  );
end;
$$;

revoke update (display_name) on table public.profiles from authenticated;
revoke all on function public.save_account_profile(text) from public, anon;
grant execute on function public.save_account_profile(text) to authenticated;

alter publication supabase_realtime add table public.profiles;
