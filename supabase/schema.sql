-- LONELY UP : 世界ランキング用スキーマ
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。

create table if not exists public.rankings (
  client_id uuid primary key,
  name text not null default 'ゲスト',
  best_height numeric not null default 0,
  clear_ms integer,
  updated_at timestamptz not null default now(),
  constraint name_length check (char_length(name) between 1 and 16),
  constraint sane_height check (best_height >= 0 and best_height <= 1000)
);

alter table public.rankings enable row level security;

-- 誰でもランキングを閲覧できる
create policy "rankings_select" on public.rankings
  for select using (true);

-- 匿名(anon キー)からのスコア登録・更新を許可
-- ※カジュアルゲーム向けのゆるい設定。厳密にしたい場合は
--   Supabase Auth の匿名サインインを有効化し、
--   using (auth.uid() = client_id) に置き換えてください。
create policy "rankings_insert" on public.rankings
  for insert with check (true);

create policy "rankings_update" on public.rankings
  for update using (true);

-- ランキング取得を高速化
create index if not exists rankings_best_height_idx
  on public.rankings (best_height desc, clear_ms asc);

-- Realtime(オンラインプレイ)は Broadcast/Presence チャンネルを使うため
-- 追加のテーブルは不要です。
