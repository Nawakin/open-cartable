import { purgeExpiredLiaison } from '../liaison/store.js';
import { purgeExpiredMessages } from '../messaging/retention.js';
import { purgeExpiredBlogPhotos } from '../blog/photos.js';

const purges = [
  { run: purgeExpiredMessages, label: 'messagerie' },
  { run: purgeExpiredLiaison, label: 'cahier de liaison' },
  { run: purgeExpiredBlogPhotos, label: 'photos du blog' },
];

export function startRetention(pool) {
  let pending;
  function run() {
    if (pending) return;
    pending = Promise.all(purges.map(async ({ run, label }) => {
      try {
        await run(pool);
      } catch {
        console.error(`La purge du service « ${label} » a échoué. Un nouvel essai est prévu.`);
      }
    })).finally(() => { pending = undefined; });
  }

  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
