self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

const notifications = {
  nouveaute: ['Vous avez une nouveauté dans votre espace.', ''],
  homework: ['Une nouvelle entrée est disponible dans le cahier de texte.', 'homework'],
  assignments: ['Un devoir a été publié.', 'assignments'],
  messages: ['Vous avez un nouveau message.', 'messages'],
  liaison: ['Un nouveau mot est disponible dans le cahier de liaison.', 'liaison'],
  blog: ['Un nouvel article est disponible dans le blog de classe.', 'blog'],
  agenda: ['Un nouvel événement est disponible dans l’agenda.', 'agenda'],
  'agenda-reminder': ['Un événement de l’agenda approche.', 'agenda-reminder'],
  attendance: ['Vérifiez le suivi des absences dans votre espace.', 'attendance'],
  reports: ['Un bilan du livret scolaire est disponible.', 'reports'],
  library: ['Une nouvelle ressource est disponible dans la médiathèque.', 'library'],
};

self.addEventListener('message', (event) => {
  if (event.data === 'notification-version') event.ports[0]?.postMessage(3);
});

self.addEventListener('push', (event) => {
  const entry = notifications[event.data?.text()];
  if (!Array.isArray(entry)) return;
  const [body, destination] = entry;
  event.waitUntil(self.registration.showNotification('Open Cartable', {
    body,
    tag: destination || 'open-cartable',
    data: { destination },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const home = new URL('/', self.location.origin);
    const { destination } = event.notification.data ?? {};
    home.searchParams.set('notification', Object.hasOwn(notifications, destination) ? destination : 'nouveaute');
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(({ url }) => url === home.href);
    if (existing) {
      await existing.focus();
      return;
    }
    await self.clients.openWindow(home.href);
  })());
});
