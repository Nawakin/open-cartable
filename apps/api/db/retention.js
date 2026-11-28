import { purgeDevicePairings } from '../devices/store.js';
import { purgeSchoolLife } from '../school-life/activities.js';
import { purgeExpiredLiaison } from '../liaison/store.js';
import { purgeExpiredMessages } from '../messaging/retention.js';
import { purgeExpiredBlogPhotos } from '../blog/photos.js';
import { purgeExpiredAttendance } from '../attendance/store.js';
import { purgeExpiredDirectionSecurity } from '../direction/security.js';
import { purgeSchoolReports } from '../school-reports/routes.js';
import { purgeClassMedia } from '../files/class-media.js';
import { purgeParentPush } from '../notifications/web-push.js';

const purges = [
  { run: purgeDevicePairings, label: 'codes de jumelage' },
  { run: purgeSchoolLife, label: 'vie de l’école' },
  { run: purgeExpiredMessages, label: 'messagerie' },
  { run: purgeExpiredLiaison, label: 'cahier de liaison' },
  { run: purgeExpiredBlogPhotos, label: 'photos du blog' },
  { run: purgeExpiredAttendance, label: 'appels' },
  { run: purgeExpiredDirectionSecurity, label: 'liens de récupération de la direction' },
  { run: purgeSchoolReports, label: 'livrets scolaires' },
  { run: purgeClassMedia, label: 'médias de classe' },
  { run: purgeParentPush, label: 'notifications web' },
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
