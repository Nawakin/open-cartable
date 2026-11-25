import { transaction } from '../db/database.js';

export async function purgeExpiredMessages(pool) {
  await transaction(pool, async (db) => {
    await db.query("DELETE FROM message_conversations WHERE last_message_at <= statement_timestamp() - interval '1 year'");
    await db.query("DELETE FROM conversation_messages WHERE sent_at <= statement_timestamp() - interval '1 year'");
  });
}
