// network-first Service Worker。アプリシェル変更時は CACHE_NAME と index.html の ?v= を同じ番号で必ず更新すること。
// ブラウザのHTTPキャッシュ(GitHub Pages は10分)に古いCSS/JSが残ると、新しいHTMLと古いCSSが混ざって崩れる(2026-11-17 に起きた)。
// そのため、取りに行く時は毎回サーバーに確かめる(no-cache。変わっていなければ304で軽い)。
const CACHE_NAME = "tcgnexus-v7";
const ASSETS = [
  ".",
  "index.html",
  "app.css?v=7",
  "icon.svg",
  "manifest.webmanifest",
  "js/app.js?v=7",
  "js/money.js",
  "js/lifecycle.js",
  "js/finance.js",
  "js/csv.js",
  "js/store.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
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
  // ページ本体(navigate)はそのまま、CSS/JSなどは毎回サーバーに確かめる
  const req = e.request.mode === "navigate" ? e.request : new Request(e.request, { cache: "no-cache" });
  e.respondWith(
    fetch(req)
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
