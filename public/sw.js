/* Service worker: shows library notifications and opens the right page when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Library', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'CBC Library', {
    body: data.body || '',
    icon: '/img/icon-192.png',
    badge: '/img/badge.png',
    data: { url: data.url || '/my' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || '/my', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if (w.url === url && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(url);
  }));
});
