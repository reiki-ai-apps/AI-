// Service Worker — network-first。
//
// 重要: index.html / app.css / js/ のいずれかを変更したら CACHE_NAME を必ず上げること。
// 上げ忘れると古いアプリシェルが残り続ける。

const CACHE_NAME = 'reiki-post-board-v37';

const SHELL = [
  './',
  './index.html',
  './gates.html',
  './app.css',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // 1つ欠けても全滅しないよう、個別に入れる（Pages側には gates.html が無い）。
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // network-first: つながるときは常に最新を取りに行き、落ちているときだけキャッシュを返す。
  //
  // cache: 'no-cache' を付けてHTTPキャッシュを必ず再検証させる。
  // 静的サーバー(python -m http.server など)は Cache-Control を返さないため、
  // これが無いとブラウザのヒューリスティックキャッシュで古いモジュールが残る。
  // 変更が無ければ304で終わるので、通信量はほとんど増えない。
  const revalidating = new Request(request, { cache: 'no-cache' });

  event.respondWith(
    fetch(revalidating)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('オフラインです。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
