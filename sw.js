/* Swapnochura Samiti PWA service worker; GitHub Pages subpath-safe. */
const CACHE_NAME = 'swapnochura-samiti-pwa-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './logo.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('swapnochura-samiti-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache Firebase/API or dynamic cross-origin requests. Network-first for page navigations.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', res.clone()));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  const path = url.pathname;
  if (path.endsWith('/logo.png') || path.endsWith('/manifest.webmanifest') || path.endsWith('/index.html')) {
    event.respondWith(caches.match(req).then(hit => fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
      return res;
    }).catch(() => hit)));
  }
});
