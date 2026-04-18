/**
 * Buchat — Service Worker
 *
 * Cache-first pour l'app shell (HTML, CSS, icons, JS).
 * Network-first pour les API (REST + Socket.IO).
 * Les messages ne sont JAMAIS mis en cache (souveraineté + confidentialité).
 */

const CACHE_VERSION = 'buchat-v2';
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './app-features.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon.ico',
];

// ---- Install : pré-cache de l'app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate : nettoyage des anciens caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---- Fetch : stratégies ----
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne JAMAIS cacher :
  //  - Les appels API (/api/*)
  //  - Socket.IO (/socket.io/*)
  //  - Les requêtes non-GET
  //  - Les schémas non-http (ex : chrome-extension://)
  if (
    event.request.method !== 'GET' ||
    !url.protocol.startsWith('http') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/')
  ) {
    return; // Laisse passer au réseau sans interception
  }

  // App shell : cache-first, puis fallback réseau
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache uniquement les réponses valides du même scope
          if (
            response.ok &&
            url.origin === self.location.origin &&
            response.type === 'basic'
          ) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback : retourne la page d'accueil si navigation
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ---- Push Notifications ----
self.addEventListener('push', (event) => {
  let data = { title: 'Buchat', body: 'Nouveau message' };
  try { data = event.data.json(); } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Buchat', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-72.png',
      data: data.data || {},
      actions: data.actions || [],
      vibrate: [200, 100, 200],
      tag: data.tag || 'buchat-msg',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/app') && 'focus' in client) {
          client.focus();
          if (chatId) client.postMessage({ type: 'OPEN_CHAT', chatId });
          return;
        }
      }
      return self.clients.openWindow('./');
    })
  );
});

// ---- Messages depuis la page (pour mises à jour forcées) ----
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
