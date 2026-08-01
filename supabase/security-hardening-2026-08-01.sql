-- AI進化レーダー: 課金枠とRLSの本番用ハードニング
-- Supabase SQL Editorで1回実行する。再実行しても安全な定義だけを含む。

begin;

alter table public.user_states enable row level security;
alter table public.subscriptions enable row level security;
alter table public.article_views enable row level security;

drop policy if exists "Users can read their own app state" on public.user_states;
create policy "Users can read their own app state"
on public.user_states for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own app state" on public.user_states;
create policy "Users can insert their own app state"
on public.user_states for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own app state" on public.user_states;
create policy "Users can update their own app state"
on public.user_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own subscription" on public.subscriptions;
create policy "Users can read their own subscription"
on public.subscriptions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own article views" on public.article_views;
create policy "Users can read their own article views"
on public.article_views for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_states from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.article_views from anon, authenticated;
grant select, insert, update on table public.user_states to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.article_views to authenticated;

-- The legacy function accepted a client-supplied limit. Remove it completely
-- so DevTools cannot call it with p_limit = -1.
drop function if exists public.record_article_view(text, integer);

create or replace function public.record_article_view(p_article_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_month text := to_char(timezone('Asia/Tokyo', now()), 'YYYY-MM');
  v_article_key text := left(trim(coalesce(p_article_key, '')), 160);
  v_count integer;
  v_limit integer := 1;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;
  if v_article_key = '' then
    raise exception 'article key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text || ':' || v_month)::bigint);

  select case
    when s.plan = 'premium'
      and (
        s.status in ('active', 'trialing')
        or (s.status = 'canceled' and s.current_period_end > now())
      ) then -1
    when s.plan = 'standard'
      and (
        s.status in ('active', 'trialing')
        or (s.status = 'canceled' and s.current_period_end > now())
      ) then 3
    else 1
  end
  into v_limit
  from public.subscriptions s
  where s.user_id = v_user;
  v_limit := coalesce(v_limit, 1);

  if exists (
    select 1 from public.article_views
    where user_id = v_user and month_key = v_month and article_key = v_article_key
  ) then
    select count(*) into v_count from public.article_views
    where user_id = v_user and month_key = v_month;
    return jsonb_build_object('allowed', true, 'count', v_count, 'limit', v_limit, 'already_counted', true);
  end if;

  select count(*) into v_count from public.article_views
  where user_id = v_user and month_key = v_month;

  if v_limit >= 0 and v_count >= v_limit then
    return jsonb_build_object('allowed', false, 'count', v_count, 'limit', v_limit);
  end if;

  insert into public.article_views (user_id, month_key, article_key)
  values (v_user, v_month, v_article_key)
  on conflict do nothing;

  select count(*) into v_count from public.article_views
  where user_id = v_user and month_key = v_month;
  return jsonb_build_object('allowed', true, 'count', v_count, 'limit', v_limit, 'already_counted', false);
end;
$$;

revoke all on function public.record_article_view(text) from public;
grant execute on function public.record_article_view(text) to authenticated;

commit;
