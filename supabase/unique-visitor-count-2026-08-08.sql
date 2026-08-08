-- AI進化レーダー: 累計ユニーク閲覧人数（同一ブラウザは1回）
create table if not exists public.unique_visitors (
  visitor_key_hash text primary key
    check (visitor_key_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now()
);

alter table public.unique_visitors enable row level security;
revoke all on table public.unique_visitors from anon, authenticated;
grant all on table public.unique_visitors to service_role;

create or replace function public.register_unique_visitor(p_visitor_key_hash text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := lower(trim(coalesce(p_visitor_key_hash, '')));
  v_count bigint;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid visitor key';
  end if;

  insert into public.unique_visitors (visitor_key_hash)
  values (v_hash)
  on conflict (visitor_key_hash) do nothing;

  select count(*) into v_count from public.unique_visitors;
  return v_count;
end;
$$;

revoke all on function public.register_unique_visitor(text) from public;
grant execute on function public.register_unique_visitor(text) to anon, authenticated;
