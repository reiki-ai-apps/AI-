-- AI進化レーダー: privacy-safe AWE conversion measurement.
-- Apply once in the Supabase SQL editor after the main schema.

create table if not exists public.app_events (
  event_id uuid primary key,
  event_name text not null
    check (event_name in ('landing_view', 'route_view', 'article_view', 'pricing_view', 'signup_start', 'signup_success', 'checkout_start', 'payment_confirmed', 'share_click', 'source_open')),
  session_key_hash text not null check (session_key_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users(id) on delete set null,
  route text not null default '',
  article_id text not null default '',
  plan text not null default 'free' check (plan in ('free', 'standard', 'premium')),
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  referrer_host text not null default '',
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index if not exists app_events_received_at_idx on public.app_events (received_at desc);
create index if not exists app_events_name_received_at_idx on public.app_events (event_name, received_at desc);
alter table public.app_events enable row level security;
revoke all on table public.app_events from anon, authenticated;
grant all on table public.app_events to service_role;

create or replace function public.record_app_event(
  p_event_id uuid,
  p_event_name text,
  p_session_key_hash text,
  p_route text default '',
  p_article_id text default '',
  p_plan text default 'free',
  p_utm_source text default '',
  p_utm_medium text default '',
  p_utm_campaign text default '',
  p_referrer_host text default '',
  p_occurred_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_name text := lower(trim(coalesce(p_event_name, '')));
  v_hash text := lower(trim(coalesce(p_session_key_hash, '')));
  v_plan text := lower(trim(coalesce(p_plan, 'free')));
begin
  if v_event_name not in ('landing_view', 'route_view', 'article_view', 'pricing_view', 'signup_start', 'signup_success', 'checkout_start', 'payment_confirmed', 'share_click', 'source_open') then
    raise exception 'invalid event name';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid session key'; end if;
  if v_plan not in ('free', 'standard', 'premium') then v_plan := 'free'; end if;

  insert into public.app_events (
    event_id, event_name, session_key_hash, user_id, route, article_id, plan,
    utm_source, utm_medium, utm_campaign, referrer_host, occurred_at
  ) values (
    p_event_id, v_event_name, v_hash, auth.uid(), left(coalesce(p_route, ''), 80),
    left(coalesce(p_article_id, ''), 100), v_plan, left(coalesce(p_utm_source, ''), 100),
    left(coalesce(p_utm_medium, ''), 100), left(coalesce(p_utm_campaign, ''), 160),
    left(coalesce(p_referrer_host, ''), 160), least(coalesce(p_occurred_at, now()), now() + interval '5 minutes')
  ) on conflict (event_id) do nothing;
  return true;
end;
$$;
revoke all on function public.record_app_event(uuid, text, text, text, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.record_app_event(uuid, text, text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated;

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
  if auth.uid() is null then raise insufficient_privilege using message = 'operator access required'; end if;
  execute 'select to_jsonb(public.get_my_membership())' into v_membership;
  v_access_source := coalesce(v_membership ->> 'access_source', v_membership -> 'get_my_membership' ->> 'access_source');
  if v_access_source is distinct from 'operator_grant' then raise insufficient_privilege using message = 'operator access required'; end if;

  return jsonb_build_object(
    'registered_users', (select count(*) from public.profiles),
    'unique_visitors', (select count(*) from public.unique_visitors),
    'funnel_7d', (
      select jsonb_build_object(
        'landing_sessions', count(distinct session_key_hash) filter (where event_name = 'landing_view'),
        'article_sessions', count(distinct session_key_hash) filter (where event_name = 'article_view'),
        'pricing_sessions', count(distinct session_key_hash) filter (where event_name = 'pricing_view'),
        'signup_starts', count(*) filter (where event_name = 'signup_start'),
        'signup_successes', count(*) filter (where event_name = 'signup_success'),
        'checkout_starts', count(*) filter (where event_name = 'checkout_start'),
        'payments_confirmed', count(*) filter (where event_name = 'payment_confirmed')
      ) from public.app_events where received_at >= now() - interval '7 days'
    )
  );
end;
$$;
revoke all on function public.operator_metrics() from public;
revoke all on function public.operator_metrics() from anon;
grant execute on function public.operator_metrics() to authenticated;
