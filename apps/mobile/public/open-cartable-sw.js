self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

const notifications = {
  nouveaute: ['Vous avez une nouveauté dans votre espace.', ''],
  homework: ['Une nouvelle entrée est disponible dans le cahier de texte.', 'homework'],
  messages: ['Vous avez un nouveau message.', 'messages'],
  liaison: ['Un nouveau mot est disponible dans le cahier de liaison.', 'liaison'],
  blog: ['Un nouvel article est disponible dans le blog de classe.', 'blog'],
  agenda: ['Un nouvel événement est disponible dans l’agenda.', 'agenda'],
  'agenda-reminder': ['Un événement de l’agenda approche.', 'agenda-reminder'],
  attendance: ['Vérifiez le suivi des absences dans votre espace.', 'attendance'],
};

self.addEventListener('message', (event) => {
  if (event.data === 'notification-version') event.ports[0]?.postMessage(2);
});

self.addEventListener('push', (event) => {
  const entry = notifications[event.data?.text()];
  if (!Array.isArray(entry)) return;
  const [body, destination] = entry;
  event.waitUntil(self.registration.showNotification('Open Cartable', {
    body,
    tag: destination === 'agenda-reminder' ? 'agenda' : (destination || 'open-cartable'),
    data: { destination },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const home = new URL('/', self.location.origin);
    const { destination } = event.notification.data ?? {};
    if (destination && Object.hasOwn(notifications, destination)) home.searchParams.set('notification', destination);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(({ url }) => {
      const current = new URL(url);
      return current.origin === home.origin && current.pathname === '/' && !current.searchParams.has('espace');
    });
    if (existing) {
      const next = await existing.navigate(home.href);
      if (next) { await next.focus(); return; }
    }
    await self.clients.openWindow(home.href);
  })());
});
