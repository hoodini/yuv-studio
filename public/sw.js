// YUV.AI Studio service worker (0.5.0). Two jobs only:
// 1. Makes the studio installable to the home screen (a PWA needs a service worker with a fetch handler).
// 2. Receives videos shared to the studio from the phone's share sheet (manifest share_target, Android):
//    parks the file in a cache and opens the mobile mode, which uploads it in chunks.
// It never caches the app or any API answer: the studio is always live from the computer that runs it.
const CACHE = 'studio-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname === '/share') {
    e.respondWith(
      (async () => {
        // The share sheet sends Sec-Fetch-Site "none". A form on another site posting here is "cross-site": refuse
        // to park its file. And even a parked file is only uploaded after the user taps to confirm (MobileApp).
        const site = e.request.headers.get('sec-fetch-site');
        if (site && site !== 'none' && site !== 'same-origin') return Response.redirect('/?m=1', 303);
        try {
          const form = await e.request.formData();
          const file = form.getAll('media').find((f) => f && typeof f === 'object' && 'size' in f);
          if (file) {
            const cache = await caches.open(CACHE);
            await cache.put('/__shared-file', new Response(file, { headers: { 'content-type': file.type || 'video/mp4', 'x-file-name': encodeURIComponent(file.name || 'shared-video.mp4') } }));
          }
        } catch {}
        return Response.redirect('/?m=1&shared=1', 303);
      })(),
    );
  }
  // Everything else goes to the network untouched.
});
