-- AI進化レーダー: レビュー機能の本番定義
begin;

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '利用者'
    check (char_length(display_name) between 1 and 40),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 20 and 600),
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

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;
revoke all on table public.reviews from anon, authenticated;
grant all on table public.reviews to service_role;

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
  select r.id, r.display_name, r.rating, r.body, r.plan_at_submission, r.created_at
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
  if v_user is null then raise exception 'authentication required'; end if;
  select created_at into v_registered_at from auth.users where id = v_user;
  if v_registered_at is null then raise exception 'user not found'; end if;
  v_eligible_at := v_registered_at + interval '7 days';
  select exists(select 1 from public.reviews where user_id = v_user) into v_has_review;
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
  if v_user is null then raise exception 'authentication required'; end if;
  select created_at into v_registered_at from auth.users where id = v_user;
  if v_registered_at is null or now() < v_registered_at + interval '7 days' then
    raise exception 'review is available seven days after registration';
  end if;
  if exists(select 1 from public.reviews where user_id = v_user) then
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
    when s.plan in ('standard', 'premium') and (
      s.status in ('active', 'trialing')
      or (s.status = 'canceled' and s.current_period_end > now())
    ) then s.plan else 'free' end
  into v_plan
  from public.subscriptions s
  where s.user_id = v_user;

  insert into public.reviews(user_id, display_name, rating, body, plan_at_submission)
  values(
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

revoke all on function public.get_published_reviews(integer) from public;
grant execute on function public.get_published_reviews(integer) to anon, authenticated;
revoke all on function public.review_prompt_status() from public;
grant execute on function public.review_prompt_status() to authenticated;
revoke all on function public.submit_review(text, integer, text) from public;
grant execute on function public.submit_review(text, integer, text) to authenticated;

commit;
