self.addEventListener('push', (event) => {
  if (event.data?.text() !== 'nouveaute') return;
  event.waitUntil(self.registration.showNotification('Open Cartable', {
    body: 'Vous avez une nouveauté dans votre espace.',
    tag: 'open-cartable',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const home = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(({ url }) => url === home);
    if (existing) await existing.focus();
    else await self.clients.openWindow(home);
  })());
});
