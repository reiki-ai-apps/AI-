-- Aggregate audience metrics for the server-recognized operator account only.
create or replace function public.operator_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership jsonb;
  v_access_source text;
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'operator access required';
  end if;

  execute 'select to_jsonb(public.get_my_membership())'
    into v_membership;

  v_access_source := coalesce(
    v_membership ->> 'access_source',
    v_membership -> 'get_my_membership' ->> 'access_source'
  );

  if v_access_source is distinct from 'operator_grant' then
    raise insufficient_privilege using message = 'operator access required';
  end if;

  return jsonb_build_object(
    'registered_users', (select count(*) from public.profiles),
    'unique_visitors', (select count(*) from public.unique_visitors)
  );
end;
$$;

revoke all on function public.operator_metrics() from public;
revoke all on function public.operator_metrics() from anon;
grant execute on function public.operator_metrics() to authenticated;
