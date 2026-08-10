// Service Worker de CuevaCoin
// Cachea el "shell" estático de la app (HTML, manifest, icono) Y las
// librerías externas de CDN de las que depende el arranque (ver
// EXTERNAL_SHELL_FILES). A propósito NO intercepta llamadas a supabase.co:
// los datos (saldos, transacciones, chat, etc.) siempre deben ir a la red,
// nunca a caché, para que la app nunca muestre saldos ni movimientos
// desactualizados.

const CACHE_NAME = 'cuevacoin-shell-v125';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/badge.png'
];

// FIX-VELOCIDAD-2 (2026-08-09, causa real de "se queda pegada en el logo
// un ratito al abrir sin internet"): index.html carga estas 8 librerías
// desde CDNs externos con <link>/<script> normales (SIN defer), que
// bloquean el parseo/pintado de la página hasta que cada una responde.
// Antes el fetch handler de acá abajo ignoraba a propósito TODO lo que no
// fuera del mismo origen ("A propósito NO intercepta..." arriba, pensado
// para supabase.co), así que estas 8 URLs nunca pasaban por este Service
// Worker y dependían 100% de la caché HTTP normal del navegador - que en
// Android/WebView se puede evictar, y que en una red "conectada pero sin
// internet real" (wifi a un router sin servicio, señal débil) no falla al
// instante sino que espera varios segundos antes de rendirse. Eso, no el
// spinner de arranque-splash en sí, era el verdadero cuello de botella.
// Ahora se precachean estas URLs exactas durante install() y el fetch
// handler las sirve cache-first (instantáneo si ya están, sin esperar
// nunca a la red) - ver bloque "cache-first para libs externas" abajo.
const EXTERNAL_SHELL_FILES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js'
];
const EXTERNAL_SHELL_URL_SET = new Set(EXTERNAL_SHELL_FILES);

// FIX (v74): responde su propia versión cuando el login la pide, así
// index.html ya no necesita un número escrito a mano (ver
// mostrarVersionApp en index.html) que se desincronizaba con el tiempo.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL_FILES);
      // Las libs externas se cachean aparte, una por una con su propio
      // try/catch: a diferencia de cache.addAll() (que aborta TODO si UNA
      // sola falla), acá si un CDN puntual está caído durante la
      // instalación no debe tumbar la precarga del shell entero - esa lib
      // en particular simplemente se reintentará en el próximo fetch
      // (queda cubierta igual por el cache-first del fetch handler, que
      // guarda en caché cualquier respuesta de red exitosa).
      await Promise.all(
        EXTERNAL_SHELL_FILES.map(async (url) => {
          try {
            const response = await fetch(url, { mode: 'cors' });
            if (response.ok) await cache.put(url, response);
          } catch (err) {
            // Sin red durante la instalación, o CORS bloqueado: no pasa
            // nada, se cachea sola en cuanto haya una petición exitosa.
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1) Borrar cachés de versiones viejas completas (ya existía).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      // 2) Limpieza dentro del caché vigente: el fetch handler guarda
      // cualquier petición GET del mismo origen que responda 200, no
      // solo SHELL_FILES. Con el tiempo eso puede dejar archivos
      // sueltos que ya no se usan (páginas o rutas viejas). Acá se
      // sacan esos "huérfanos" y solo queda el shell actual.
      const cache = await caches.open(CACHE_NAME);
      const cachedRequests = await cache.keys();
      const shellPaths = new Set(
        SHELL_FILES.map((f) => new URL(f, self.location.origin).pathname)
      );
      await Promise.all(
        cachedRequests
          // FIX-VELOCIDAD-2: las libs externas (EXTERNAL_SHELL_URL_SET) no
          // tienen un "pathname" comparable al del shell propio (son otro
          // origen) y antes esta limpieza las hubiera borrado como
          // "huérfanas" en cada activate() - se excluyen a propósito acá.
          .filter((req) => !shellPaths.has(new URL(req.url).pathname) && !EXTERNAL_SHELL_URL_SET.has(req.url))
          .map((req) => cache.delete(req))
      );
    })()
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear ni interceptar Supabase (auth, datos, edge functions).
  if (url.hostname.endsWith('supabase.co')) {
    return;
  }

  // FIX-VELOCIDAD-2 (2026-08-09): cache-first para las libs externas del
  // arranque (fuentes, supabase-js, cropper, qrcode, jsQR, jspdf,
  // Chart.js). A diferencia del shell propio (stale-while-revalidate más
  // abajo, que SIEMPRE dispara la red aunque haya caché, para poder
  // actualizarse), acá basta con devolver la caché de una si existe y ni
  // siquiera tocar la red - son librerías versionadas en la URL (ej.
  // "@2", "1.6.2"), nunca cambian de contenido para la misma URL, así que
  // no hay nada que "revalidar". Esto es lo que elimina la espera real:
  // ya no dependen de si hay internet o no.
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

  // Solo manejar peticiones GET del propio origen (el shell estático).
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

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
          // Sin caché y sin red: si no devolvemos nada válido acá,
          // respondWith recibe undefined y el navegador muestra un error
          // de red poco claro. Para navegación de páginas, mejor caer al
          // shell ya cacheado (index.html) que a un error en blanco;
          // para cualquier otra petición (CSS/JS/íconos sueltos), una
          // respuesta 503 explícita.
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

// ============================================
// NOTIFICACIONES PUSH (punto 13a/13b del roadmap)
// ============================================
// Se dispara cuando llega un push real desde el servidor. La Edge Function
// "enviar-push" (13b, fuera de este repo - vive en Supabase) ya está en uso
// desde index.html en muchos puntos (retiros, chat, ajustes de saldo, etc.)
// - este comentario decía "nada dispara esto todavía" pero quedó
// desactualizado (mismo patrón de "narrativa un paso atrás del código" de
// siempre). v107 además agregó sincronizarSuscripcionPush() del lado de
// index.html para que la fila en push_suscripciones nunca quede
// desactualizada sin que la persona tenga que reactivar a mano.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Si el payload no es JSON, lo tratamos como texto plano en el cuerpo.
    data = { title: 'CuevaCoin', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'CuevaCoin';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    // FIX (v109): badge.png es un PNG con fondo TRANSPARENTE y solo el
    // trazo de las 2 "C" opaco. Android pinta el badge de la barra de
    // notificaciones usando SOLO el canal alfa de esta imagen (todo lo
    // opaco se vuelve un silueta blanca) - con icon.png (opaco de borde a
    // borde) el resultado era un cuadrado blanco sólido, que es justo el
    // bug reportado. No confundir con "icon", que sí se ve a color dentro
    // de la notificación expandida y por eso sigue usando el logo completo.
    badge: '/badge.png',
    // FIX (v109): antes el tag siempre caía en el mismo valor fijo
    // 'cuevacoin-notificacion' porque enviar-push (Edge Function) nunca
    // manda data.tag. Con renotify:true y el MISMO tag en cada push, el
    // navegador trata cada notificación nueva como "la misma" y
    // reemplaza la tarjeta anterior en vez de apilar una nueva - por
    // eso solo se veía la última. Ahora, si no viene un tag explícito
    // desde el servidor, se genera uno único por notificación para que
    // cada push quede como su propia tarjeta independiente. Si en el
    // futuro se quiere que cierto tipo de aviso SÍ reemplace al
    // anterior (ej. "saldo actualizado" varias veces seguidas), ahí sí
    // conviene mandar un tag fijo a propósito desde enviar-push.
    tag: data.tag || `cuevacoin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    renotify: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: enfoca una pestaña ya abierta de la app si existe,
// o abre una nueva, llevando al usuario a la URL que venga en el push (por
// defecto, la raíz de la app).
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
