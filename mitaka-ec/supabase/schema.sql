-- =====================================================================
-- 三高産業 顧客データ基盤 v2 (Supabase / PostgreSQL)
-- 方針: 検索・集計・権限の軸になる項目は「実の列」。3D構成や取込原文だけ jsonb。
--       接点ログ・同意・イベントは「追記型」(訂正は打ち消し行を足す)。
-- 旧v1(全部 data jsonb)からの移行は scripts/migrate-v1-to-v2.sql を参照。
-- =====================================================================

-- 担当者(Supabase Auth のユーザーと1対1)
create table if not exists staff (
  id text primary key,
  auth_user_id uuid unique,
  name text not null,
  tel text,
  area_codes text[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 顧客(法人・個人・JA)
create table if not exists customers (
  id text primary key,
  customer_code text unique not null,        -- 6桁。担当者が口頭・電話で使う
  karte_token text unique not null,          -- 32桁。カルテURLの認証に使う(コードとは分ける)
  kind text not null default 'individual',   -- individual / corporate / ja
  name text not null,
  farm_name text,
  tel_norm text,                             -- 数字のみに正規化
  tel_display text,
  email text,
  area_code text,                            -- 市町村
  address text,
  crop text,
  owner_staff_id text references staff(id),
  sales_system_code text,                    -- 販売管理の得意先コード(金は販売管理が正)
  status text not null default 'active',     -- prospect / active / dormant / lost
  merged_into_id text references customers(id),  -- 重複統合。物理削除しない
  redacted_at timestamptz,                   -- 削除依頼を受けたら個人項目をマスク
  note text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists customers_tel_idx on customers(tel_norm);
create index if not exists customers_area_idx on customers(area_code);

-- 連絡先(後継者・配偶者・JA担当など)
create table if not exists contacts (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  name text, role text, tel_norm text, is_primary boolean default false,
  created_at timestamptz default now()
);

-- 連携ID(電話・LINE・メール・販売管理・EC訪問者)。突合の中核
create table if not exists identities (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  channel text not null,                     -- tel / line / email / sales_system / ec_visitor
  value_norm text not null,
  verified_at timestamptz,
  created_at timestamptz default now(),
  unique (channel, value_norm)
);

-- 圃場
create table if not exists plots (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  name text, area_code text, lat double precision, lng double precision, note text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- ハウス(会社の資産台帳。担当が辞めても残る中心)
create table if not exists houses (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  plot_id text references plots(id) on delete set null,
  house_no text,
  span_m numeric, length_m numeric, eave_m numeric, ridge_m numeric,
  pipe_mm numeric, pitch_m numeric,
  film_type text, film_installed_on date,
  built_year int, crop text, area_code text,
  condition text default '良好',             -- 良好 / 要補修 / 要相談
  status text default 'active',              -- active / dismantled
  spec jsonb default '{}'::jsonb,            -- 3D構成(変動が激しいのでjsonbのまま)
  note text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists houses_customer_idx on houses(customer_id);
create index if not exists houses_film_idx on houses(film_installed_on);

-- ハウスの部材(張替年・交換履歴の本体)
create table if not exists house_components (
  id text primary key,
  house_id text not null references houses(id) on delete cascade,
  component_type text not null,              -- film / side_vent / curtain / door / irrigation / frame
  product_code text, installed_on date, expected_life_years int, replaced_on date,
  created_at timestamptz default now()
);

-- ハウスに起きたこと(追記型)
create table if not exists house_events (
  id text primary key,
  house_id text not null references houses(id) on delete cascade,
  event_type text not null,                  -- built / recover / repair / inspect / damage / dismantle
  occurred_on date not null, summary text, amount numeric,
  staff_id text references staff(id),
  created_at timestamptz default now()
);

-- 見積(3D構成のスナップショットと単価版を必ず残す)
create table if not exists quotes (
  id text primary key,
  quote_no text unique,
  customer_id text references customers(id) on delete set null,
  house_id text references houses(id) on delete set null,
  source text,                               -- simulator / karte / catalog / phone / visit
  status text not null default 'requested',  -- requested/drafted/sent/approved/in_progress/done/lost
  sim_params jsonb, pricing_version text,
  subtotal numeric, tax numeric, total numeric,
  contact_name text, contact_tel text, contact_email text, place text, message text,
  staff_id text references staff(id),
  sent_at timestamptz, decided_at timestamptz, lost_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists quotes_status_idx on quotes(status);

create table if not exists quote_items (
  id text primary key,
  quote_id text not null references quotes(id) on delete cascade,
  product_code text, name_snapshot text, spec_snapshot text, unit text,
  unit_price_snapshot numeric, qty numeric, amount numeric, needs_check boolean default false
);

-- 施工・修理のジョブ
create table if not exists jobs (
  id text primary key,
  customer_id text references customers(id) on delete set null,
  house_id text references houses(id) on delete set null,
  quote_id text references quotes(id) on delete set null,
  job_type text,                             -- install / recover / repair / inspect
  status text default 'scheduled',           -- scheduled / in_progress / done / canceled
  scheduled_on date, completed_on date, crew text, note text,
  created_at timestamptz default now()
);

-- 接点ログ(電話・LINE・訪問・FAX)。いま最も失われている資産。追記型
create table if not exists interactions (
  id text primary key,
  customer_id text references customers(id) on delete set null,
  house_id text references houses(id) on delete set null,
  channel text not null,                     -- phone_in / phone_out / line / visit / fax / ec / mail
  topic_tag text,                            -- 見積 / 修理 / 納期 / 苦情 / 雑談 / 注文
  occurred_at timestamptz not null default now(),
  staff_id text references staff(id),
  body text,
  next_action_on date,
  created_at timestamptz default now()
);
create index if not exists interactions_customer_idx on interactions(customer_id, occurred_at desc);

-- ECの行動(取るのはこの5種だけ。マウス軌跡や広告IDは取らない)
create table if not exists ec_events (
  id text primary key,
  occurred_at timestamptz not null default now(),
  visitor_id text, customer_id text references customers(id) on delete set null,
  event_type text not null,                  -- product_view / cart_add / sim_save / quote_request / karte_view
  product_code text, ref text
);
create index if not exists ec_events_time_idx on ec_events(occurred_at desc);

-- やること(張替時期・見積放置・災害点検・折り返し)
create table if not exists tasks (
  id text primary key,
  customer_id text references customers(id) on delete cascade,
  house_id text references houses(id) on delete set null,
  quote_id text references quotes(id) on delete set null,
  kind text not null,                        -- film_due / quote_followup / inspection / callback / disaster_check
  title text, due_on date,
  assignee_staff_id text references staff(id),
  status text default 'open',                -- open / done / snoozed
  done_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists tasks_due_idx on tasks(status, due_on);

-- 同意(目的別・追記型。取り消しは revoked_at を入れた行を足す)
create table if not exists consents (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  purpose text not null,                     -- karte / stats / showcase / line_push / share_ja
  granted boolean not null,
  granted_on date, revoked_on date, staff_id text references staff(id),
  created_at timestamptz default now()
);

-- 添付(写真はStorageに置き、ここは参照だけ。base64をDBに入れない)
create table if not exists attachments (
  id text primary key,
  customer_id text references customers(id) on delete cascade,
  house_id text references houses(id) on delete cascade,
  interaction_id text references interactions(id) on delete cascade,
  kind text,                                 -- photo / pdf
  storage_path text not null, width int, height int, bytes int,
  created_at timestamptz default now()
);

-- 商品(販売管理から夜間CSVで同期。CRM→販売管理へは書き戻さない)
create table if not exists products (
  product_code text primary key,
  maker text, category text, name text, spec text, unit text,
  price numeric, is_active boolean default true, synced_at timestamptz
);

-- 監査ログ
create table if not exists audit_log (
  id bigserial primary key,
  table_name text, row_id text, action text, actor text,
  before jsonb, after jsonb, at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 図鑑(匿名統計)。名前・場所は出さず、市町村×作物で5件以上ある組合せだけ
-- ---------------------------------------------------------------------
create or replace view house_stats as
select h.crop, h.area_code, h.span_m, h.length_m, h.pipe_mm, h.film_type,
       h.built_year, extract(year from h.film_installed_on)::int as film_year
from houses h
join customers c on c.id = h.customer_id
where h.status = 'active' and c.redacted_at is null
  and exists (select 1 from consents s where s.customer_id = c.id and s.purpose = 'stats' and s.granted and s.revoked_on is null)
  and (select count(*) from houses h2 join customers c2 on c2.id = h2.customer_id
       where h2.area_code = h.area_code and h2.crop = h.crop) >= 5;

-- ---------------------------------------------------------------------
-- 権限(RLS)。ここを間違えると全顧客の氏名・電話が公開される
--   担当者: Supabase Auth でログインした authenticated だけが読み書き
--   お客様: テーブルには触れず、下の RPC 1本だけで自分のカルテを読む
--   EC訪問者: ec_events に追加できるだけ(読み取り不可)
-- ---------------------------------------------------------------------
alter table staff enable row level security;
alter table customers enable row level security;
alter table contacts enable row level security;
alter table identities enable row level security;
alter table plots enable row level security;
alter table houses enable row level security;
alter table house_components enable row level security;
alter table house_events enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table jobs enable row level security;
alter table interactions enable row level security;
alter table ec_events enable row level security;
alter table tasks enable row level security;
alter table consents enable row level security;
alter table attachments enable row level security;
alter table products enable row level security;
alter table audit_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['staff','customers','contacts','identities','plots','houses','house_components',
                           'house_events','quotes','quote_items','jobs','interactions','tasks','consents',
                           'attachments','products','audit_log']
  loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ECの行動ログだけ、匿名の訪問者が追加できる(読み取りは担当者のみ)
drop policy if exists ec_insert_anon on ec_events;
create policy ec_insert_anon on ec_events for insert to anon with check (true);
drop policy if exists ec_read_staff on ec_events;
create policy ec_read_staff on ec_events for select to authenticated using (true);

-- 見積依頼の受け口(匿名で作成のみ。読み取りは担当者)
drop policy if exists quotes_insert_anon on quotes;
create policy quotes_insert_anon on quotes for insert to anon with check (status = 'requested');
drop policy if exists quote_items_insert_anon on quote_items;
create policy quote_items_insert_anon on quote_items for insert to anon with check (true);

-- お客様のカルテ閲覧: トークンを知っている人だけが自分の分を読める
create or replace function rpc_get_karte(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cust customers; result jsonb;
begin
  select * into cust from customers where karte_token = token and redacted_at is null;
  if not found then return null; end if;
  select jsonb_build_object(
    'customer', to_jsonb(cust) - 'karte_token' - 'sales_system_code' - 'note' - 'data',
    'plots', coalesce((select jsonb_agg(to_jsonb(p)) from plots p where p.customer_id = cust.id), '[]'::jsonb),
    'houses', coalesce((select jsonb_agg(to_jsonb(h)) from houses h where h.customer_id = cust.id and h.status = 'active'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from house_events e join houses h on h.id = e.house_id where h.customer_id = cust.id), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function rpc_get_karte(text) from public;
grant execute on function rpc_get_karte(text) to anon, authenticated;

-- 監査(主要テーブルの変更を残す)
create or replace function fn_audit() returns trigger language plpgsql as $$
begin
  insert into audit_log(table_name, row_id, action, actor, before, after)
  values (tg_table_name, coalesce(new.id, old.id), tg_op, coalesce(auth.uid()::text, 'anon'),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['customers','houses','quotes','consents'] loop
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function fn_audit()', t);
  end loop;
end $$;
