// Service Worker per Simulatore Concorso UniSS 2026
// Supporta aggiornamenti automatici in background e funzionamento offline completo

const CACHE_NAME = 'uniss-simulatore-v7.0.2-web';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './banca_dati.js',
  './firebase-config.js',
  './firebase-service.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Installazione: memorizza tutti i file in cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // Forza l'attivazione immediata se richiesto
      return self.skipWaiting();
    })
  );
});

// Attivazione: pulisce le vecchie versioni della cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name.startsWith('uniss-simulatore-')) {
            console.log('[ServiceWorker] Rimozione vecchia cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: Network-first per banca dati e aggiornamenti, fallback su cache per uso offline
self.addEventListener('fetch', (event) => {
  // Ignora richieste non HTTP/HTTPS (es. chrome-extension o file://)
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Se la richiesta va a buon fine, aggiorna la cache in background
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Se siamo offline, recupera dalla cache locale
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Se la navigazione fallisce, rimanda alla index
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline: risorsa non disponibile', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

// Gestione messaggi dal client
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
