-- LONELY UP : 世界ランキングをリセットする
--
-- 使い方: Supabase ダッシュボード > SQL Editor にこの内容を貼り付けて実行してください。
-- (SQL Editor は管理者権限で動くため RLS を無視して削除できます。
--  公開用の anon キーには削除ポリシーを与えていないので、アプリ側からは消せません。)

-- 全記録を削除する (テーブル定義・ポリシー・インデックスはそのまま残す)
delete from public.rankings;

-- ※ 一瞬で空にしたい場合は truncate でも可 (auto-vacuum 的にも軽い):
-- truncate table public.rankings;

-- 実行後、残り件数の確認 (0 になっていれば成功):
select count(*) as remaining from public.rankings;
