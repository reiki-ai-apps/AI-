-- Additive migration. Preserve legacy totals, UUID idempotency and operator-only reads.
begin;
alter table public.app_open_events
  add column if not exists visitor_key_hash text,
  add column if not exists occurred_at timestamptz,
  add column if not exists source_group text,
  add column if not exists page_kind text;
create index if not exists app_open_events_visitor_idx
  on public.app_open_events(visitor_key_hash) where visitor_key_hash is not null;
create index if not exists app_open_events_effective_time_idx
  on public.app_open_events((coalesce(occurred_at, opened_at)));
alter table public.app_open_events enable row level security;
revoke all on public.app_open_events from public, anon, authenticated;
grant all on public.app_open_events to service_role;

create or replace function public.record_app_open_v2(
  p_event_id uuid, p_visitor_key_hash text, p_occurred_at timestamptz,
  p_source_group text, p_page_kind text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_access jsonb;
  v_time timestamptz;
  v_source text;
begin
  if auth.uid() is not null then
    execute 'select to_jsonb(public.get_my_membership())' into v_access;
    if coalesce(v_access->>'access_source',v_access->'get_my_membership'->>'access_source')='operator_grant' then
      return false;
    end if;
  end if;
  if p_event_id is null or (p_visitor_key_hash is not null and p_visitor_key_hash !~ '^[0-9a-f]{64}$') then
    raise invalid_parameter_value using message='invalid event identity';
  end if;
  -- Preserve offline opening time (up to 30 days). Never accept future timestamps.
  v_time := case when p_occurred_at between now()-interval '30 days' and now()+interval '5 minutes'
    then least(p_occurred_at,now()) else now() end;
  v_source := case when p_source_group in ('google','bing','yahoo','duckduckgo','brave','x','youtube','note','instagram','facebook','other','direct_unknown','internal','unrecorded')
    then p_source_group else 'direct_unknown' end;
  if p_visitor_key_hash is not null then
    insert into public.unique_visitors(visitor_key_hash,first_seen_at) values(p_visitor_key_hash,v_time)
      on conflict (visitor_key_hash) do update set first_seen_at=least(public.unique_visitors.first_seen_at,excluded.first_seen_at);
  end if;
  insert into public.app_open_events(event_id,visitor_key_hash,occurred_at,source_group,page_kind)
    values(p_event_id,p_visitor_key_hash,v_time,v_source,case when p_page_kind='article' then 'article' else 'app' end)
    -- A lost acknowledgement may already have committed the same UUID. Do not count twice.
    -- Legacy fallback may have inserted a UUID without details; enrich only that row.
    on conflict(event_id) do update set visitor_key_hash=excluded.visitor_key_hash,
      occurred_at=excluded.occurred_at,source_group=excluded.source_group,page_kind=excluded.page_kind
      where public.app_open_events.occurred_at is null;
  return true;
end;
$$;
revoke all on function public.record_app_open_v2(uuid,text,timestamptz,text,text) from public;
grant execute on function public.record_app_open_v2(uuid,text,timestamptz,text,text) to anon, authenticated;

create or replace function public.operator_access_insights(p_period text default '7d')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_access jsonb;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if auth.uid() is null then raise insufficient_privilege using message='operator access required'; end if;
  execute 'select to_jsonb(public.get_my_membership())' into v_access;
  if coalesce(v_access->>'access_source',v_access->'get_my_membership'->>'access_source','')<>'operator_grant' then
    raise insufficient_privilege using message='operator access required';
  end if;
  if p_period not in ('today','yesterday','7d','30d','all') or p_period is null then
    raise invalid_parameter_value using message='invalid period';
  end if;
  v_to := case when p_period='yesterday' then v_today else v_today+1 end;
  v_from := case p_period when 'today' then v_today when 'yesterday' then v_today-1
    when '7d' then v_today-6 when '30d' then v_today-29
    else coalesce((select min((coalesce(occurred_at,opened_at) at time zone 'Asia/Tokyo')::date) from public.app_open_events),v_today) end;
  -- Aggregation reads event history directly. No scheduled materialization can be missed.
  with events as (
    select e.*,coalesce(e.occurred_at,e.opened_at) at time zone 'Asia/Tokyo' as time_jst,
      u.first_seen_at at time zone 'Asia/Tokyo' as first_jst
    from public.app_open_events e left join public.unique_visitors u using(visitor_key_hash)
    where coalesce(e.occurred_at,e.opened_at)>=v_from::timestamp at time zone 'Asia/Tokyo'
      and coalesce(e.occurred_at,e.opened_at)<v_to::timestamp at time zone 'Asia/Tokyo'
  ), days as (
    select time_jst::date as day,count(*) as opens,count(distinct visitor_key_hash) as unique_browsers,
      count(distinct visitor_key_hash) filter(where first_jst::date=time_jst::date) as new_browsers,
      count(distinct visitor_key_hash) filter(where first_jst::date<time_jst::date) as returning_browsers,
      count(*) filter(where visitor_key_hash is null) as unknown_opens
    from events group by 1
  ), sources as (
    select coalesce(source_group,'unrecorded') as source,count(*) as opens,
      count(distinct visitor_key_hash) as unique_browsers from events group by 1
  ), hours as (
    select extract(hour from time_jst)::integer as hour,count(*) as opens from events group by 1
  ) select jsonb_build_object(
    'version',1,'timezone','Asia/Tokyo','period',p_period,'from',v_from,'through',v_to-1,'as_of',now(),
    'details_started_at',(select min(opened_at) from public.app_open_events where occurred_at is not null),
    'totals',jsonb_build_object('opens',(select count(*) from public.app_open_events),
      'unique_browsers',(select count(*) from public.unique_visitors)),
    'summary',(select jsonb_build_object('opens',count(*),'unique_browsers',count(distinct visitor_key_hash),
      'new_browsers',count(distinct visitor_key_hash) filter(where first_jst::date>=v_from),
      'returning_browsers',count(distinct visitor_key_hash) filter(where first_jst::date<v_from),
      'unknown_opens',count(*) filter(where visitor_key_hash is null)) from events),
    'daily',(select jsonb_agg(jsonb_build_object('day',g::date,'opens',coalesce(d.opens,0),
      'unique_browsers',coalesce(d.unique_browsers,0),'new_browsers',coalesce(d.new_browsers,0),
      'returning_browsers',coalesce(d.returning_browsers,0),'unknown_opens',coalesce(d.unknown_opens,0)) order by g)
      from generate_series(v_from::timestamp,(v_to-1)::timestamp,interval '1 day') g left join days d on d.day=g::date),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.opens desc,s.source) from sources s),'[]'::jsonb),
    'hourly',(select jsonb_agg(jsonb_build_object('hour',h,'opens',coalesce(hours.opens,0)) order by h)
      from generate_series(0,23) h left join hours on hours.hour=h)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.operator_access_insights(text) from public,anon;
grant execute on function public.operator_access_insights(text) to authenticated;
notify pgrst, 'reload schema';
commit;
