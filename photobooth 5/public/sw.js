/* Service worker van de photobooth: zorgt dat de booth ook zonder internet opent en werkt.
   - De boothpagina: eerst via internet (dan altijd de nieuwste versie), anders de bewaarde versie.
   - Scripts en logo's: direct uit de bewaarde versie, op de achtergrond bijgewerkt.
   - Ontwerpen, stickers, videokaders en muziek: uit de bewaarde versie (die veranderen niet onder dezelfde naam).
   Alles wat niet de booth betreft (dashboard, uploads, bediening) gaat gewoon via internet. */
const CACHE = 'pb-cache-v1';
const SHELL = ['/booth.html', '/render.js', '/qrcode.min.js', '/festiq-wordmark.jpg', '/festiq-logo.jpg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pb-cache-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const offline = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h2>Geen internet</h2><p>Deze booth is op dit apparaat nog niet eerder geopend. Open hem één keer met internet; daarna werkt hij ook offline.</p></body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;

  // boothpagina (/booth/<evenement>): netwerk eerst, anders bewaarde versie
  if (req.mode === 'navigate' && u.pathname.startsWith('/booth/')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await withTimeout(fetch(req), 5000);
        if (r.ok) c.put('/booth.html', r.clone());
        return r;
      } catch {
        return (await c.match('/booth.html')) || offline();
      }
    })());
    return;
  }

  // ontwerpen, stickers, kaders, muziek: bewaarde versie eerst
  if (/^\/media\/(stickers|strips|frames|music)\//.test(u.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(u.pathname);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.status === 200) c.put(u.pathname, r.clone());
      return r;
    })());
    return;
  }

  // scripts en logo's: direct uit bewaarde versie, op de achtergrond verversen
  if (SHELL.includes(u.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(u.pathname);
      const fresh = fetch(req).then((r) => { if (r.ok) c.put(u.pathname, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(fresh); return hit; }
      return (await fresh) || new Response('', { status: 504 });
    })());
  }
});
