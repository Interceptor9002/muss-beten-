const SHELL = "rk-shell-v52", EXT = "rk-ext-v52";
const DATEIEN = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(DATEIEN.map(u => c.add(new Request(u, { cache:"reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.filter(n => n !== SHELL && n !== EXT).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);

  if (u.origin !== location.origin){
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r && r.ok){
          const c = await caches.open(EXT);
          c.put(req, r.clone());
        }
        return r;
      } catch(_){
        const c = await caches.open(EXT);
        return (await c.match(req)) || Response.error();
      }
    })());
    return;
  }

  if (u.pathname.endsWith("/worker.js")){
    e.respondWith(fetch(req, { cache:"reload" }).catch(() => caches.match(req)));
    return;
  }

  if (req.mode === "navigate" || u.pathname.endsWith("/index.html")){
    e.respondWith((async () => {
      try {
        const r = await fetch(req, { cache:"reload" });
        const c = await caches.open(SHELL);
        c.put("./index.html", r.clone());
        return r;
      } catch(_){
        const c = await caches.open(SHELL);
        return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const t = await c.match(req);
    if (t) return t;
    try { return await fetch(req) } catch(_){ return Response.error() }
  })());
});