// アプリシェルの構成を変えたときは日付を更新する。
// 画像などの静的アセットも network-first なので、同名差し替えは次回通信時に反映される。
const CACHE_NAME = "ai-radar-v3-20260809-admin-counts-always-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/ai-radar-icon.webp",
  "./assets/ai-radar-icon-192.png",
  "./assets/ai-radar-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL)
        // data.json はベストエフォートで先読みする(失敗してもインストールは成功させる)。
        .then(() => cache.add("./data.json").catch(() => {}))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // data.json: クエリ付きで取得されても素のパスに正規化して1エントリだけ保存する。
  // オフライン時はキャッシュ済み data.json を返し、無ければ素直に失敗させる
  // (index.html を返すと呼び出し側の res.json() が壊れるため絶対に返さない)。
  if (url.pathname.endsWith("/data.json")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./data.json", copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match("./data.json").then(hit => hit || Response.error()))
    );
    return;
  }

  if (request.mode === "navigate") {
    // キャッシュ即応・裏で更新: アプリ本体はキャッシュから即座に返して
    // 「開いた直後の真っ白な画面」をなくす。同時に裏で最新版を取得して
    // キャッシュを更新し、新版が届いたら sw.js 更新経由でアプリ内の
    // 「今すぐ更新」通知が出る。
    event.respondWith(
      caches.match("./index.html").then(cached => {
        const network = fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy)).catch(() => {});
          }
          return response;
        });
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        return network.catch(() => caches.match("./index.html").then(hit => hit || Response.error()));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(request))
  );
});
