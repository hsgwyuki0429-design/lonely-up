import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.listen(PORT, () => {
  console.log(`LONELY UP listening on :${PORT}`);
});
