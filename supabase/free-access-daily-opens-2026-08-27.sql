-- AI進化レーダー: サブスク廃止後の無料開放と日次表示回数
-- Supabase SQL Editor でこのファイル全体を1回実行する。
-- 既存の課金データは、安全な解約対応のため削除しない。

begin;

create table if not exists public.app_open_events (
  event_id uuid primary key,
  opened_at timestamptz not null default now()
);

create index if not exists app_open_events_opened_at_idx
  on public.app_open_events (opened_at desc);

alter table public.app_open_events enable row level security;
revoke all on table public.app_open_events from anon, authenticated;
grant all on table public.app_open_events to service_role;

create or replace function public.record_app_open(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_id is null then
    raise exception 'invalid open event id';
  end if;

  insert into public.app_open_events (event_id)
  values (p_event_id)
  on conflict (event_id) do nothing;

  return true;
end;
$$;

revoke all on function public.record_app_open(uuid) from public;
grant execute on function public.record_app_open(uuid) to anon, authenticated;

-- 集計値は、運営者権限がサーバーで確認できた本人だけへ返す。
-- app_events / record_app_event が未導入の本番環境でも単独で適用できる。
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
    'unique_visitors', (select count(*) from public.unique_visitors),
    'daily_opens', (
      select count(*)
      from public.app_open_events
      where opened_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
        and opened_at < ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')
    ),
    'daily_opens_date', to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD')
  );
end;
$$;

revoke all on function public.operator_metrics() from public;
revoke all on function public.operator_metrics() from anon;
grant execute on function public.operator_metrics() to authenticated;

commit;
