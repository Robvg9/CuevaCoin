// Service Worker de CuevaCoin
// Cachea el "shell" estático de la app (HTML, manifest, icono) Y las
// librerías externas de CDN de las que depende el arranque (ver
// EXTERNAL_SHELL_FILES). A propósito NO intercepta llamadas a supabase.co:
// los datos (saldos, transacciones, chat, etc.) siempre deben ir a la red,
// nunca a caché, para que la app nunca muestre saldos ni movimientos
// desactualizados.

const CACHE_NAME = 'cuevacoin-shell-v151';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/icon-192.png',
  '/badge.png'
];

const EXTERNAL_SHELL_FILES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
];
const EXTERNAL_SHELL_URL_SET = new Set(EXTERNAL_SHELL_FILES);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL_FILES);
      await Promise.all(
        EXTERNAL_SHELL_FILES.map(async (url) => {
          try {
            const response = await fetch(url, { mode: 'cors' });
            if (response.ok) await cache.put(url, response);
          } catch (err) {}
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      const cache = await caches.open(CACHE_NAME);
      const cachedRequests = await cache.keys();
      const shellPaths = new Set(
        SHELL_FILES.map((f) => new URL(f, self.location.origin).pathname)
      );
      await Promise.all(
        cachedRequests
          .filter((req) => !shellPaths.has(new URL(req.url).pathname) && !EXTERNAL_SHELL_URL_SET.has(req.url))
          .map((req) => cache.delete(req))
      );
    })()
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.hostname.endsWith('supabase.co')) return;

  if (event.request.method === 'GET' && EXTERNAL_SHELL_URL_SET.has(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            const shell = await caches.match('/index.html');
            if (shell) return shell;
          }
          return new Response('Sin conexión y sin datos guardados en este dispositivo.', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'CuevaCoin', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'CuevaCoin';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/badge.png',
    tag: data.tag || `cuevacoin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    renotify: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
