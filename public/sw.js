const CACHE = 'vault-offline-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('vault-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
// No API responses, login tokens, HTML containing user data, or note bodies enter a cache.
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.mode === 'navigate'
      && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
  }
});
