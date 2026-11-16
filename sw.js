// App-shell cache so Steady opens offline. (WebLLM caches model weights itself via the Cache API.)
const V = "steady-v1";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== V).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !(u.origin === location.origin || u.hostname === "cdn.jsdelivr.net")) return; // let model downloads pass through
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit || c.match("index.html"));
    return hit || net; // stale-while-revalidate
  }));
});
