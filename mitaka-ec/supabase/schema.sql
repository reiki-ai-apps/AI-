-- ハウスカルテ用テーブル(Supabase / PostgreSQL)
-- レコード本体は data(jsonb) に保存し、検索に使う列だけを取り出しています。
-- assets/store.js の SupabaseStore がこの形で読み書きします。

create table if not exists customers (
  id text primary key,
  code text unique,                -- お客様コード(カルテURLに使う)
  customer_id text,                -- 未使用(他テーブルと列をそろえるため)
  updated_at timestamptz default now(),
  data jsonb not null
);
create table if not exists plots (
  id text primary key,
  customer_id text references customers(id) on delete cascade,
  code text,
  updated_at timestamptz default now(),
  data jsonb not null
);
create table if not exists houses (
  id text primary key,
  customer_id text references customers(id) on delete cascade,
  code text,
  updated_at timestamptz default now(),
  data jsonb not null
);
create index if not exists houses_customer_idx on houses(customer_id);
create index if not exists plots_customer_idx on plots(customer_id);

-- 図鑑(匿名統計)用ビュー: 名前や場所を含めず、仕様と作物・市町村だけを出す
create or replace view house_stats as
select
  data->>'crop' as crop,
  data->>'area' as area,
  (data->'params'->>'span')::numeric as span,
  (data->'params'->>'length')::numeric as length,
  (data->'params'->>'pipe')::numeric as pipe,
  data->'params'->>'film' as film,
  (data->'params'->>'snow')::boolean as snow,
  (data->>'builtYear')::int as built_year,
  (data->>'filmYear')::int as film_year
from houses
where coalesce((data->'consent'->>'statsOk')::boolean, true);

-- 行レベルセキュリティ
-- プロトタイプ段階: anonキーで読み書き可(社内テスト用)。
-- 本番前に必ず次の方針へ変更する:
--   1. 担当者は Supabase Auth でログインし、authenticated ロールにのみ書き込みを許可
--   2. お客様は自分の code を含むURLからしか読めないよう、RPC(security definer)経由で取得
alter table customers enable row level security;
alter table plots enable row level security;
alter table houses enable row level security;
create policy "proto_all_customers" on customers for all to anon using (true) with check (true);
create policy "proto_all_plots" on plots for all to anon using (true) with check (true);
create policy "proto_all_houses" on houses for all to anon using (true) with check (true);
