// PWA 用サービスワーカー: ネットワーク優先 + キャッシュフォールバック。
// オンライン時は常に最新を取りに行き、圏外でも一度遊んだ端末なら起動できる。
const CACHE = 'lonely-up-v3.0'; // アプデのたびに上げる (旧キャッシュは activate で破棄される)
const CORE = [
  '/',
  '/css/style.css',
  '/js/main.js', '/js/audio.js', '/js/config.js', '/js/fx.js',
  '/js/ghosts.js', '/js/input.js', '/js/net.js', '/js/player.js',
  '/js/rng.js', '/js/tower.js', '/js/ui.js', '/js/world.js',
  '/vendor/three.module.js', '/vendor/supabase.js',
  '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === '/env.js') return; // 実行時設定は常にサーバーから

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(
          (hit) => hit || (e.request.mode === 'navigate' ? caches.match('/') : undefined)
        )
      )
  );
});
