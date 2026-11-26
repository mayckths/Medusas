// Medusas · service worker — solo notificaciones push.
// A propósito NO intercepta fetch ni cachea nada: la app se sigue
// actualizando por el ?v= de siempre.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* payload no JSON */ }
  e.waitUntil(self.registration.showNotification(data.title || 'Medusas', {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { hash: data.hash || '#/inicio' },
  }));
});

// Al tocar la notificación: trae la app al frente en la sección
// correspondiente, o la abre si estaba cerrada.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || '#/inicio';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'medusas-navigate', hash });
        return;
      }
    }
    await self.clients.openWindow(new URL('./' + hash, self.registration.scope).href);
  })());
});
