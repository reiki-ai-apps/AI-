-- Enable public, login-free reviews while exposing no account or browser key.
-- Run once in the Supabase SQL editor.
begin;

alter table public.reviews alter column user_id drop not null;
alter table public.reviews add column if not exists reviewer_key_hash text;

create unique index if not exists reviews_reviewer_key_hash_key
  on public.reviews (reviewer_key_hash)
  where reviewer_key_hash is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reviews'::regclass
      and conname = 'reviews_identity_present'
  ) then
    alter table public.reviews
      add constraint reviews_identity_present
      check (user_id is not null or reviewer_key_hash is not null);
  end if;
end;
$$;

create or replace function public.public_review_status(p_reviewer_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hash text := lower(trim(coalesce(p_reviewer_key_hash, '')));
  v_has_review boolean;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid reviewer key';
  end if;

  select exists (
    select 1
    from public.reviews r
    where r.reviewer_key_hash = v_hash
       or (v_user is not null and r.user_id = v_user)
  ) into v_has_review;

  return jsonb_build_object('eligible', true, 'has_review', v_has_review);
end;
$$;

create or replace function public.submit_public_review(
  p_reviewer_key_hash text,
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
  v_hash text := lower(trim(coalesce(p_reviewer_key_hash, '')));
  v_plan text := 'free';
  v_review_id bigint;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid reviewer key';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 20
     or char_length(trim(coalesce(p_body, ''))) > 600 then
    raise exception 'review body must be between 20 and 600 characters';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hash)::bigint);
  if exists (
    select 1
    from public.reviews r
    where r.reviewer_key_hash = v_hash
       or (v_user is not null and r.user_id = v_user)
  ) then
    raise exception 'review already submitted';
  end if;

  if v_user is not null then
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
  end if;

  begin
    insert into public.reviews (
      user_id,
      reviewer_key_hash,
      display_name,
      rating,
      body,
      plan_at_submission
    ) values (
      v_user,
      v_hash,
      left(coalesce(nullif(trim(p_display_name), ''), '利用者'), 40),
      p_rating,
      trim(p_body),
      coalesce(v_plan, 'free')
    )
    returning id into v_review_id;
  exception when unique_violation then
    raise exception 'review already submitted';
  end;

  return v_review_id;
end;
$$;

revoke all on function public.public_review_status(text) from public;
grant execute on function public.public_review_status(text) to anon, authenticated;
revoke all on function public.submit_public_review(text, text, integer, text) from public;
grant execute on function public.submit_public_review(text, text, integer, text) to anon, authenticated;

commit;
