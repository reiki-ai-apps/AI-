-- Additive only: preserves existing counters and hardened operator authorization.
create schema if not exists radar_private;
revoke all on schema radar_private from public;
grant usage on schema radar_private to anon, authenticated;
create table if not exists radar_private.open_campaigns (
 event_id uuid primary key references public.app_open_events(event_id) on delete cascade,
 campaign text not null default '',
 landing text not null default '',
 received_at timestamptz not null default now()
);
alter table radar_private.open_campaigns enable row level security;
revoke all on radar_private.open_campaigns from public, anon, authenticated;
create index if not exists open_campaigns_received_idx on radar_private.open_campaigns(received_at desc);
create or replace function radar_private.record_open_campaign(
 p_event_id uuid,p_visitor_key_hash text,p_occurred_at timestamptz,p_source_group text,p_page_kind text,
 p_campaign text,p_landing text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_existing boolean; v_ok boolean; v_campaign text; v_landing text;
begin
 if exists(select 1 from public.plan_grants g where g.user_id=auth.uid() and g.active and g.reason='operator'
 and (g.expires_at is null or g.expires_at>now())) then return false; end if;
 if p_event_id is null then raise invalid_parameter_value using message='invalid identity'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 select exists(select 1 from public.app_open_events where event_id=p_event_id) into v_existing;
 v_ok:=public.record_app_open_v2(p_event_id,p_visitor_key_hash,p_occurred_at,p_source_group,p_page_kind);
 if not v_ok or v_existing then return v_ok; end if;
 v_campaign:=case when p_campaign ~ '^kizashi-[a-z0-9-]{1,64}$' then p_campaign else '' end;
 v_landing:=case when p_landing ~ '^(guide-[a-z0-9-]{1,64}|article_[A-Za-z0-9_-]{8,90}|home)$' then p_landing else '' end;
 insert into radar_private.open_campaigns(event_id,campaign,landing)
 values(p_event_id,v_campaign,v_landing) on conflict do nothing;
 return true;
end $$;
revoke all on function radar_private.record_open_campaign(uuid,text,timestamptz,text,text,text,text) from public;
grant execute on function radar_private.record_open_campaign(uuid,text,timestamptz,text,text,text,text) to anon,authenticated;
create or replace function public.record_app_open_v3(
 p_event_id uuid,p_visitor_key_hash text,p_occurred_at timestamptz,p_source_group text,p_page_kind text,
 p_campaign text default '',p_landing text default '')
returns boolean language sql security invoker set search_path='' as $$
 select radar_private.record_open_campaign(p_event_id,p_visitor_key_hash,p_occurred_at,p_source_group,p_page_kind,p_campaign,p_landing);
$$;
revoke all on function public.record_app_open_v3(uuid,text,timestamptz,text,text,text,text) from public;
grant execute on function public.record_app_open_v3(uuid,text,timestamptz,text,text,text,text) to anon,authenticated;
create or replace function radar_private.campaign_insights(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_to timestamptz; v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.plan_grants g where g.user_id=auth.uid()
 and g.active and g.reason='operator' and (g.expires_at is null or g.expires_at>now()))
 then raise insufficient_privilege using message='operator access required'; end if;
 if p_days is null or p_days<1 or p_days>90 then raise invalid_parameter_value using message='invalid days'; end if;
 v_to:=(((now() at time zone 'Asia/Tokyo')::date+1)::timestamp at time zone 'Asia/Tokyo');
 v_from:=v_to-make_interval(days=>p_days);
 with entries as (
 select c.campaign,c.landing,e.source_group,e.visitor_key_hash,e.occurred_at,u.first_seen_at
 from radar_private.open_campaigns c join public.app_open_events e using(event_id)
 left join public.unique_visitors u using(visitor_key_hash)
 where e.occurred_at>=v_from and e.occurred_at<v_to and c.campaign<>''
 ), groups as (
 select campaign,landing,source_group as source,count(*) as opens,count(distinct visitor_key_hash) as unique_browsers,
 count(distinct visitor_key_hash) filter(where (first_seen_at at time zone 'Asia/Tokyo')::date=(occurred_at at time zone 'Asia/Tokyo')::date) as new_browsers,
 count(distinct visitor_key_hash) filter(where exists(
 select 1 from public.app_open_events r where r.visitor_key_hash=entries.visitor_key_hash
 and (coalesce(r.occurred_at,r.opened_at) at time zone 'Asia/Tokyo')::date>(entries.occurred_at at time zone 'Asia/Tokyo')::date
 and coalesce(r.occurred_at,r.opened_at)<v_to)) as returned_browsers
 from entries group by 1,2,3
 ) select jsonb_build_object('version',1,'days',p_days,'timezone','Asia/Tokyo',
 'from',(v_from at time zone 'Asia/Tokyo')::date,'through',(v_to at time zone 'Asia/Tokyo')::date-1,
 'as_of',now(),'started_at',(select min(received_at) from radar_private.open_campaigns),
 'campaigns',coalesce((select jsonb_agg(to_jsonb(g) order by unique_browsers desc,campaign) from groups g),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function radar_private.campaign_insights(integer) from public,anon;
grant execute on function radar_private.campaign_insights(integer) to authenticated;
create or replace function public.operator_campaign_insights(p_days integer default 14)
returns jsonb language sql stable security invoker set search_path='' as $$select radar_private.campaign_insights(p_days);$$;
revoke all on function public.operator_campaign_insights(integer) from public,anon;
grant execute on function public.operator_campaign_insights(integer) to authenticated;
notify pgrst,'reload schema';

