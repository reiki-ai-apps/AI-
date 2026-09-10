// アプリシェルの構成を変えたときは日付を更新する。
// 画像などの静的アセットも network-first なので、同名差し替えは次回通信時に反映される。
const CACHE_NAME = "ai-radar-v5-20260910-first-open-recovery-v30";
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
    caches.open(CACHE_NAME).then(async cache => {
      // HTTPキャッシュに残った古いHTMLを再利用せず、公開中の最新版を保存する。
      await Promise.all(APP_SHELL.map(async path => {
        const response = await fetch(path,{cache:"reload"});
        if(!response.ok)throw new Error(`app shell fetch failed: ${path}`);
        await cache.put(path,response);
      }));
      // 記事の先読みをインストールの必須処理にしない。画面側の取得と競合させない。
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async()=>{
      const keys=await caches.keys();
      // 更新中も前回の記事をオフラインで読めるよう、新キャッシュへ引き継ぐ。
      const current=await caches.open(CACHE_NAME);
      const previousData=await caches.match('./data.json');
      if(previousData&&!await current.match('./data.json'))await current.put('./data.json',previousData);
      await Promise.all(keys.filter(key=>key.startsWith('ai-radar-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));
      await self.clients.claim();
      // clients.navigateで画面を強制再読込しない。進行中の初回取得を中断しない。
    })()
  );
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
      fetch(request,{cache:"no-store"})
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

  const scopePath = new URL(self.registration.scope).pathname;
  const isAppDocument = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;

  if (request.mode === "navigate" && isAppDocument) {
    // アプリ本体はネットワークを優先し、スマホに古い画面を残さない。
    // オフライン時だけ、インストール時に保存したHTMLへフォールバックする。
    event.respondWith(
      fetch(request,{cache:"no-store"}).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy)).catch(() => {});
        }
        return response;
      }).catch(() => caches.match("./index.html").then(hit => hit || Response.error()))
    );
    return;
  }

  // sw.js・manifest・画像などをブラウザで直接開いても、index.html の
  // キャッシュへ上書きしない。アプリ本体のURLだけをアプリシェルとして扱う。
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
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
