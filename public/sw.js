// Self-destructing Service Worker to purge legacy PWA cache
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      // Reload controlled tabs so the first open after a deploy serves
      // fresh bytes instead of the shell the old worker already drew.
      return self.clients.matchAll({ type: 'window' });
    }).then((clients) => {
      clients.forEach((client) => {
        client.navigate(client.url).catch(() => {});
      });
    })
  );
});
