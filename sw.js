/* Vertikal CRM · Service Worker */
const VERSION = 'vkcrm-v2.0.2';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/config.js', './js/app.js', './js/store.js', './js/google.js', './js/sync.js', './js/util.js',
  './icons/logo.png', './icons/mark.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.png'
];
const SNAP_CACHE = 'vkcrm-snapshot';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== SNAP_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // APIs de Google siempre en red
  // Red primero para que las actualizaciones lleguen rápido; caché como respaldo offline.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

// Revisión periódica de tareas atrasadas (Chrome Android con la PWA instalada)
async function checkOverdue() {
  const cache = await caches.open(SNAP_CACHE);
  const res = await cache.match('./__snapshot.json');
  if (!res) return;
  const snap = await res.json();
  const now = Date.now();
  const overdue = (snap.tasks || []).filter(t => t.dueMs && t.dueMs < now);
  if (!overdue.length) return;
  const lastKey = overdue.map(t => t.id).sort().join(',');
  if (snap.lastNotifiedKey === lastKey && now - (snap.lastNotifiedAt || 0) < 4 * 3600e3) return;
  await self.registration.showNotification(`Tienes ${overdue.length} tarea${overdue.length > 1 ? 's' : ''} atrasada${overdue.length > 1 ? 's' : ''}`, {
    body: overdue.slice(0, 4).map(t => '• ' + t.title).join('\n'),
    icon: './icons/icon-192.png', badge: './icons/favicon.png', tag: 'vk-overdue', renotify: true,
    data: { url: './#/tasks?f=overdue' }
  });
  snap.lastNotifiedKey = lastKey; snap.lastNotifiedAt = now;
  await cache.put('./__snapshot.json', new Response(JSON.stringify(snap), { headers: { 'content-type': 'application/json' } }));
  if (self.navigator && 'setAppBadge' in self.navigator) self.navigator.setAppBadge(overdue.length).catch(() => {});
}

self.addEventListener('periodicsync', e => { if (e.tag === 'vk-overdue') e.waitUntil(checkOverdue()); });
self.addEventListener('message', e => { if (e.data === 'check-overdue') e.waitUntil(checkOverdue()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './#/dashboard';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
