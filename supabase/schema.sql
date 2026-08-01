-- AI進化レーダー: authentication profile and subscription state
-- Run once in the Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'standard', 'premium')),
  status text not null default 'inactive'
    check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stripe webhook event IDs are stored to prevent duplicate processing.
create table if not exists public.stripe_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.article_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  article_key text not null,
  viewed_at timestamptz not null default now(),
  primary key (user_id, month_key, article_key)
);

create table if not exists public.support_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  category text not null,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '利用者'
    check (char_length(display_name) between 1 and 40),
  rating smallint not null
    check (rating between 1 and 5),
  body text not null
    check (char_length(body) between 20 and 600),
  plan_at_submission text not null default 'free'
    check (plan_at_submission in ('free', 'standard', 'premium')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists user_states_set_updated_at on public.user_states;
create trigger user_states_set_updated_at
before update on public.user_states
for each row execute function public.set_updated_at();

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

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

  -- Serialize view counting for this user/month so parallel requests cannot
  -- pass the limit check at the same time.
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

  return jsonb_build_object('allowed', true, 'count', v_count + 1, 'limit', v_limit, 'already_counted', false);
end;
$$;

-- Public reviews expose no account ID or email. A member can submit only once,
-- beginning seven days after registration. Only the service role can edit/delete.
create or replace function public.get_published_reviews(p_limit integer default 30)
returns table (
  id bigint,
  display_name text,
  rating smallint,
  body text,
  plan text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.display_name,
    r.rating,
    r.body,
    r.plan_at_submission,
    r.created_at
  from public.reviews r
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

create or replace function public.review_prompt_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_registered_at timestamptz;
  v_has_review boolean;
  v_eligible_at timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  select created_at into v_registered_at
  from auth.users
  where id = v_user;

  v_eligible_at := v_registered_at + interval '7 days';
  select exists (
    select 1 from public.reviews where user_id = v_user
  ) into v_has_review;

  return jsonb_build_object(
    'eligible', now() >= v_eligible_at,
    'has_review', v_has_review,
    'eligible_at', v_eligible_at
  );
end;
$$;

create or replace function public.submit_review(
  p_display_name text,
  p_rating integer,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_registered_at timestamptz;
  v_plan text := 'free';
  v_review_id bigint;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  select created_at into v_registered_at
  from auth.users
  where id = v_user;

  if v_registered_at is null or now() < v_registered_at + interval '7 days' then
    raise exception 'review is available seven days after registration';
  end if;

  if exists (select 1 from public.reviews where user_id = v_user) then
    raise exception 'review already submitted';
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  if char_length(trim(coalesce(p_body, ''))) < 20
     or char_length(trim(coalesce(p_body, ''))) > 600 then
    raise exception 'review body must be between 20 and 600 characters';
  end if;

  select case
    when s.plan in ('standard', 'premium')
      and (
        s.status in ('active', 'trialing')
        or (s.status = 'canceled' and s.current_period_end > now())
      ) then s.plan
    else 'free'
  end
  into v_plan
  from public.subscriptions s
  where s.user_id = v_user;

  insert into public.reviews (
    user_id,
    display_name,
    rating,
    body,
    plan_at_submission
  )
  values (
    v_user,
    left(coalesce(nullif(trim(p_display_name), ''), '利用者'), 40),
    p_rating,
    trim(p_body),
    coalesce(v_plan, 'free')
  )
  returning id into v_review_id;

  return v_review_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'inactive')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill accounts created before the profile trigger was installed.
insert into public.profiles (id, email, display_name)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name')
from auth.users
on conflict (id) do nothing;

-- Publicly expose only the total registration count. No profile fields are returned.
create or replace function public.registered_user_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.profiles;
$$;

-- Let an authenticated free user permanently delete only their own account.
-- Paid accounts must be canceled first so billing cannot continue after deletion.
create or replace function public.delete_own_free_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_status text;
  v_deleted_count integer;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  select plan, status into v_plan, v_status
  from public.subscriptions
  where user_id = v_user;

  if v_plan in ('standard', 'premium')
     and v_status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete') then
    raise exception 'paid subscription must be canceled first';
  end if;

  -- Support messages contain a copy of the reply email, so remove them explicitly.
  delete from public.support_requests where user_id = v_user;
  delete from auth.users where id = v_user;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.user_states enable row level security;
alter table public.article_views enable row level security;
alter table public.support_requests enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can read their own subscription" on public.subscriptions;
create policy "Users can read their own subscription"
on public.subscriptions for select
to authenticated
using ((select auth.uid()) = user_id);

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

drop policy if exists "Users can read their own article views" on public.article_views;
create policy "Users can read their own article views"
on public.article_views for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create support requests" on public.support_requests;
create policy "Users can create support requests"
on public.support_requests for insert to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;
revoke all on table public.user_states from anon, authenticated;
revoke all on table public.article_views from anon, authenticated;
revoke all on table public.support_requests from anon, authenticated;
revoke all on table public.reviews from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.subscriptions to authenticated;
grant select, insert, update on table public.user_states to authenticated;
grant select on table public.article_views to authenticated;
grant insert on table public.support_requests to authenticated;
grant usage, select on sequence public.support_requests_id_seq to authenticated;
revoke all on function public.get_published_reviews(integer) from public;
grant execute on function public.get_published_reviews(integer) to anon, authenticated;
revoke all on function public.review_prompt_status() from public;
grant execute on function public.review_prompt_status() to authenticated;
revoke all on function public.submit_review(text, integer, text) from public;
grant execute on function public.submit_review(text, integer, text) to authenticated;
revoke all on function public.registered_user_count() from public;
grant execute on function public.registered_user_count() to anon, authenticated;
revoke all on function public.record_article_view(text) from public;
grant execute on function public.record_article_view(text) to authenticated;
revoke all on function public.delete_own_free_account() from public;
grant execute on function public.delete_own_free_account() to authenticated;

grant all on table public.profiles to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.stripe_events to service_role;
grant all on table public.user_states to service_role;
grant all on table public.article_views to service_role;
grant all on table public.support_requests to service_role;
grant all on table public.reviews to service_role;
