import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '4kb' }));

// 定数時間でのパスワード比較 (タイミング攻撃対策)
function passwordOk(given) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false; // 未設定なら常に不許可 (=リセット機能は無効)
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Runtime config injection: Render env vars -> browser.
// The Supabase anon key is safe to expose (protected by RLS).
app.get('/env.js', (_req, res) => {
  res
    .type('application/javascript')
    .set('Cache-Control', 'no-store')
    .send(
      `window.__ENV=${JSON.stringify({
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
      })};`
    );
});

app.get('/healthz', (_req, res) => res.send('ok'));

// 管理者用: 世界ランキングを全消去する。
// パスワード (ADMIN_PASSWORD) が一致した時だけ、service_role キーで RLS を無視して削除する。
// service_role キーはサーバー内でのみ使い、ブラウザには絶対に渡さない。
app.post('/admin/reset-rankings', async (req, res) => {
  const given = req.get('x-admin-password') || req.body?.password || '';
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ ok: false, error: 'ADMIN_PASSWORD が未設定です' });
  }
  if (!passwordOk(given)) {
    return res.status(401).json({ ok: false, error: 'パスワードが違います' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です' });
  }
  try {
    // PostgREST は無条件 DELETE を拒否するため、全行に必ず当たる条件を付ける
    // (best_height は制約で常に >= 0)。return=representation で削除件数を得る。
    const r = await fetch(`${url}/rest/v1/rankings?best_height=gte.0`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=representation',
      },
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ ok: false, error: `Supabase ${r.status}: ${body.slice(0, 200)}` });
    }
    const rows = await r.json().catch(() => []);
    return res.json({ ok: true, deleted: Array.isArray(rows) ? rows.length : null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.listen(PORT, () => {
  console.log(`LONELY UP listening on :${PORT}`);
});
