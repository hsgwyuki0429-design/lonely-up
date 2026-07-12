# LONELY UP — 開発メモ

モバイル中心の縦スクロール登山ゲーム (Three.js + Express + Supabase, Render にデプロイ)。

## バージョン運用 (重要)

**コードを更新してデプロイするたびに、バージョンを 0.1 上げること。** 次の3か所を必ず揃える:

1. `public/js/config.js` の `VERSION` (例: `'1.1'` → `'1.2'`) — タイトル画面に `v1.2` と表示される
2. `package.json` の `version` (例: `1.1.0` → `1.2.0`)
3. `public/sw.js` の `CACHE` 名 (例: `'lonely-up-v1.1'` → `'lonely-up-v1.2'`) — 旧キャッシュは activate 時に破棄される

タイトル画面右下の `vX.Y` 表示で、Render のデプロイが反映されたかを目視確認できる。

## 動作確認

`node server.js` で起動 (既定 :3000)。同梱 Chromium + Playwright でブラウザ操作して確認できる
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `executablePath: '/opt/pw-browsers/chromium'`)。
ジャイロは合成 `deviceorientation` イベントで検証可能だが、**左右/上下の絶対的な向きの正解は実機でしか判定できない** (合成イベントの符号が実機と一致する保証がないため)。
