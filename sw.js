// 電波がなくてもアプリの画面を開けるように、画面のファイルだけを保存しておく（データはGitHubから毎回読む）
// 画面のファイルを変えたら、CACHE の番号を上げる（古い画面が残らないように）
const CACHE = 'goi-tore-v8';
const FILES = ['./', 'index.html', 'style.css', 'qrcode.js', 'app.js','manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // GitHubのAPIは保存しない
  // 画面のファイルは、ネットにつながれば最新、つながらなければ保存分
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
