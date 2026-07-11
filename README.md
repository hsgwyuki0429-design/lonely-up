# 🗼 LONELY UP

**ひたすら上へ。落ちたら、自分のせい。**

「Only Up」ジャンル(垂直登りフォディアン)をスマホ向けに最適化したオリジナル3Dクライミングゲームです。
全プレイヤーが同じシード値から生成された同一の塔 (高さ300m) を登り、**世界ランキング**と**オンライン同時プレイ**(他プレイヤーがリアルタイムで見える)に対応しています。

- チェックポイントなし。落ちたら落ちたぶんだけ登り直し
- 高度帯で変化する景色(草原 → 岩山 → 夕焼けの雪原 → 星空)
- 動く足場・細い梁・休憩ポイント
- 世界ランキング: 最高到達高度 + 登頂タイム (Supabase Postgres)
- オンラインプレイ: 他プレイヤーの姿と名前がリアルタイム表示 (Supabase Realtime)
- Supabase 未設定でもオフラインでそのまま遊べます

## 操作方法

| 操作 | スマホ | PC |
|---|---|---|
| 移動 | 画面**左半分**をドラッグ(ジョイスティック) | WASD / 矢印キー |
| カメラ | 画面**右半分**をドラッグ | マウスドラッグ |
| ジャンプ | JUMPボタン | Space |

## ローカルで動かす

```bash
npm install   # postinstall で public/vendor にライブラリをコピー
npm start     # http://localhost:3000
```

Supabase なしでも起動できます(オフラインモード)。オンライン機能を試すには下記の環境変数を付けて起動します:

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... npm start
```

## Supabase のセットアップ

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. **SQL Editor** で [`supabase/schema.sql`](supabase/schema.sql) の内容を実行(ランキングテーブル + RLS ポリシー)
3. **Project Settings → API** から以下を控える
   - `Project URL` → `SUPABASE_URL`
   - `anon public` キー → `SUPABASE_ANON_KEY`

オンラインプレイは Supabase Realtime の Broadcast / Presence チャンネルを使うため、追加設定は不要です。

## Render へのデプロイ

リポジトリ直下の [`render.yaml`](render.yaml) を使います。

1. このリポジトリを GitHub に push
2. [Render ダッシュボード](https://dashboard.render.com) → **New → Blueprint** でこのリポジトリを選択
   (または **New → Web Service** で `Build: npm install` / `Start: npm start` を手動設定)
3. 環境変数を設定
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. デプロイ完了後、発行された URL をスマホで開けばプレイできます

> anon キーはブラウザに公開される前提のキーです(RLS で保護)。`service_role` キーは絶対に設定しないでください。

## 構成

```
├── server.js              # Express: 静的配信 + /env.js で環境変数をブラウザへ注入
├── render.yaml            # Render Blueprint
├── supabase/schema.sql    # ランキングテーブル + RLS
├── scripts/copy-vendor.mjs# three.js / supabase-js を public/vendor へコピー
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js        # ゲームループ・状態遷移
        ├── config.js      # 共通定数 (シード・物理パラメータ)
        ├── rng.js         # 決定論的乱数 (全員同じ塔を生成)
        ├── world.js       # 塔の生成・空・衝突判定
        ├── player.js      # プレイヤー物理・アバター
        ├── input.js       # タッチ / キーボード入力
        ├── ghosts.js      # 他プレイヤー表示
        ├── net.js         # Supabase (ランキング + Realtime)
        ├── ui.js          # HUD・パネル
        └── audio.js       # WebAudio 効果音
```

## 技術メモ

- **公平なランキング**: 塔は固定シードの決定論的乱数で生成されるため、全プレイヤーが完全に同じコースを登ります
- **モバイル最適化**: 静的な足場は 1 つの `InstancedMesh`(1ドローコール)、影はブロブシャドウ、`devicePixelRatio` は 2 まで、フォグで描画距離を制限
- **オンライン同期**: 位置は 120ms 間隔の Realtime Broadcast。他プレイヤーはローカルで補間表示
- **注意**: スコアはクライアント申告制です(カジュアル用途向け)。厳密な不正対策が必要な場合は Supabase Auth + サーバ側検証を追加してください
