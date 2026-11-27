export const notificationCategories = ['homework', 'messages', 'liaison', 'blog', 'agenda', 'attendance'];
export const payloadVersionBody = { const: 2 };
export const preferenceFields = {
  type: 'object', additionalProperties: false, required: ['categories', 'weekends'],
  properties: {
    categories: { type: 'array', maxItems: notificationCategories.length, uniqueItems: true, items: { enum: notificationCategories } },
    weekends: { type: 'boolean' },
  },
};
const preferenceColumns = 'categories, weekends, payload_version AS "payloadVersion"';

export async function readPreferences(db, sessionId, transport) {
  const { rows: [preferences] } = await db.query(`
    SELECT ${preferenceColumns} FROM parent_push_subscriptions WHERE (session_id, transport) = ($1, $2)
  `, [sessionId, transport]);
  return { enabled: Boolean(preferences),
    ...(preferences ?? { categories: notificationCategories, weekends: true, payloadVersion: 2 }) };
}

export async function savePreferences(db, sessionId, transport, body) {
  const { rows: [preferences] } = await db.query(`
    UPDATE parent_push_subscriptions
    SET categories = COALESCE($3, categories), weekends = COALESCE($4, weekends), payload_version = COALESCE($5, payload_version)
    WHERE (session_id, transport) = ($1, $2) RETURNING ${preferenceColumns}
  `, [sessionId, transport, body.categories ?? null, body.weekends ?? null, body.payloadVersion ?? null]);
  return preferences ?? null;
}

export async function removeSubscription(db, sessionId, transport) {
  await db.query('DELETE FROM parent_push_subscriptions WHERE (session_id, transport) = ($1, $2)', [sessionId, transport]);
}
