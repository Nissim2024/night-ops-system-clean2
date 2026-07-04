/* Service Worker — DeployCenter Push Notifications */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title   = data.title   || 'DeployCenter';
  const options = {
    body:               data.body    || '',
    icon:               data.icon    || '/logo192.png',
    badge:              '/logo192.png',
    tag:                data.tag     || 'deploycenter',
    data:               data.data    || {},
    requireInteraction: !!data.urgent,
    vibrate:            data.urgent ? [200, 100, 200, 100, 200] : [100],
    dir:                'rtl',
    lang:               'he',
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Post message to all open windows so they can play sound
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'PUSH_SOUND', urgent: !!data.urgent, notifType: data.data?.type })
        );
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
