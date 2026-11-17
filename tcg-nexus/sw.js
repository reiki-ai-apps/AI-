// network-first Service Worker。アプリシェル変更時は CACHE_NAME を必ず更新すること。
const CACHE_NAME = "tcgnexus-v5";
const ASSETS = [
  ".",
  "index.html",
  "app.css",
  "icon.svg",
  "manifest.webmanifest",
  "js/app.js",
  "js/money.js",
  "js/lifecycle.js",
  "js/finance.js",
  "js/csv.js",
  "js/store.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          // エラー応答(404/500等)で正常キャッシュを上書きしない
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
