// Service worker — ONLY for Web Push. Deliberately does NOT implement any
// fetch/cache handling (no offline support) — the app has never had that
// and this feature shouldn't silently introduce it. Registered by
// js/push.js, only after the user opts in to notifications.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* non-JSON payload — ignore */ }

  const title = data.title || 'Nhóp Nhép';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'nhopnhep-push',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
