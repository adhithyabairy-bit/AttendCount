// ============================================================
// AttendCount Service Worker v1.0
// Strategy: Cache-first for shell, Network-first for API
// ============================================================

const CACHE_NAME = 'attendcount-v21';
const OFFLINE_URL = '/';

// Assets to pre-cache on install (shell + design assets)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/manifest.json',
  '/js/auth.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/setup.js',
  '/js/dashboard.js',
  '/js/holidays.js',
  '/js/classes.js',
  '/js/push.js',
  '/js/onboarding.js',
  '/js/quick.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// API domains that should always use network-first
const NETWORK_FIRST_PATTERNS = [
  /supabase\.co/,
  /googleapis\.com/,
];

// ─── Install ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// ─── Activate (clean old caches) ─────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// ─── Fetch (routing strategy) ────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // Network-first for API calls
  if (NETWORK_FIRST_PATTERNS.some((p) => p.test(url.href))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for shell assets
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback — serve cached index
    const fallback = await caches.match(OFFLINE_URL);
    return fallback || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ─── Push Notifications ───────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'AttendCount';
  const options = {
    body: data.body || 'You have a class now!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'class-reminder',
    renotify: true,
    data: { url: data.url || '/#dashboard' },
    actions: [
      { action: 'present', title: '✓ Present' },
      { action: 'absent',  title: '✗ Absent'  },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const url = event.notification.data?.url || '/';
  const notificationData = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existingClient = clientList.find(c => c.url.includes(location.origin));
        if (existingClient) {
          existingClient.focus();
          existingClient.postMessage({ type: 'NOTIFICATION_ACTION', action, url, notificationData });
        } else {
          clients.openWindow(url);
        }
      })
  );
});
