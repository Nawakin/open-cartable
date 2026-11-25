import { transaction } from '../db/database.js';

export async function purgeExpiredMessages(pool) {
  await transaction(pool, async (db) => {
    await db.query("DELETE FROM direction_conversations WHERE last_message_at <= statement_timestamp() - interval '1 year'");
    await db.query("DELETE FROM direction_messages WHERE sent_at <= statement_timestamp() - interval '1 year'");
  });
}

export function startMessageCleanup(pool) {
  let pending;
  function run() {
    if (pending) return;
    pending = purgeExpiredMessages(pool).catch(() => {
      console.error('La purge des messages expirés a échoué. Un nouvel essai est prévu.');
    }).finally(() => { pending = undefined; });
  }

  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
