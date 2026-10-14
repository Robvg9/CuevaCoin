// Service Worker de CuevaCoin
// Cachea el "shell" estático de la app (HTML, manifest, icono) Y las
// librerías externas de CDN de las que depende el arranque (ver
// EXTERNAL_SHELL_FILES). A propósito NO intercepta llamadas a supabase.co:
// los datos (saldos, transacciones, chat, etc.) siempre deben ir a la red,
// nunca a caché, para que la app nunca muestre saldos ni movimientos
// desactualizados.

const CACHE_NAME = 'cuevacoin-shell-v139';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
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
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json' || url.pathname === '/icon.png' || url.pathname === '/badge.png')) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});