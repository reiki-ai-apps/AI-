-- Keep anonymous duplicate-prevention registration without exposing audience totals.
drop function if exists public.register_unique_visitor(text);

create function public.register_unique_visitor(p_visitor_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := lower(trim(coalesce(p_visitor_key_hash, '')));
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid visitor key';
  end if;

  insert into public.unique_visitors (visitor_key_hash)
  values (v_hash)
  on conflict (visitor_key_hash) do nothing;

  return true;
end;
$$;

revoke all on function public.register_unique_visitor(text) from public;
grant execute on function public.register_unique_visitor(text) to anon, authenticated;

-- Registration totals are internal and unavailable to browser application roles.
revoke all on function public.registered_user_count() from public;
revoke all on function public.registered_user_count() from anon, authenticated;
