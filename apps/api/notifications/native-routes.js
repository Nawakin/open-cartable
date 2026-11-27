import { createHmac } from 'node:crypto';
import { sealPrivateFile } from '../files/private-files.js';
import { preferenceFields, readPreferences, removeSubscription, savePreferences } from './subscriptions.js';

const path = '/parent/notifications/:transport';
const params = {
  type: 'object', additionalProperties: false, required: ['transport'], properties: { transport: { enum: ['fcm', 'apns'] } },
};
const tokenFields = {
  type: 'object', additionalProperties: false, required: ['token'],
  properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_:-]{32,1024}$' }, payloadVersion: { const: 3 } },
};
const apnsToken = /^(?:[0-9a-f]{2}){16,256}$/i;

function nativeToken(input, transport) {
  if (transport === 'fcm') return input;
  if (!apnsToken.test(input)) throw Object.assign(new Error('Jeton APNs non valide.'), { statusCode: 400 });
  return input.toLowerCase();
}

async function subscribe(db, sessionId, transport, { token: input, payloadVersion = 2 }, key, refresh) {
  const token = nativeToken(input, transport);
  const digest = createHmac('sha256', key).update(transport + ':').update(token).digest();
  const bytes = sealPrivateFile(Buffer.from(token), key, ['native-push', transport, sessionId]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext('native-push-enrollment'), hashtext($1))", [transport]);
  const { rows: [existing] } = await db.query(`
    SELECT transport, device_digest FROM parent_push_subscriptions WHERE session_id = $1 FOR UPDATE
  `, [sessionId]);
  if ((existing && existing.transport !== transport) || (refresh && !existing)) return null;
  if (existing?.device_digest?.equals(digest)) {
    if (payloadVersion === 3) await savePreferences(db, sessionId, transport, { payloadVersion });
    return;
  }
  if (refresh) {
    // Seule une activation explicite peut réattribuer un appareil à une autre session.
    const owner = await db.query('SELECT 1 FROM parent_push_subscriptions WHERE (transport, device_digest) = ($1, $2)', [transport, digest]);
    if (owner.rowCount) return null;
  } else {
    await db.query('DELETE FROM parent_push_subscriptions WHERE (transport, device_digest) = ($1, $2) AND session_id <> $3',
      [transport, digest, sessionId]);
  }
  await db.query(`
    INSERT INTO parent_push_subscriptions (session_id, transport, subscription, device_digest, payload_version)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (session_id) DO UPDATE SET subscription = excluded.subscription, device_digest = excluded.device_digest,
      attempted_at = '-infinity', payload_version = GREATEST(parent_push_subscriptions.payload_version, excluded.payload_version)
  `, [sessionId, transport, bytes, digest, payloadVersion]);
}

export function registerNativePush(app, authenticated, { key, transports }) {
  const forDevice = (operation, status) => authenticated(async (request, db, _actor, _reply, { sessionId }) => {
    const { transport } = request.params;
    if (!Object.hasOwn(transports, transport)) return null;
    return operation(db, sessionId, transport, request.body);
  }, status);
  const writes = (body) => ({ bodyLimit: 2048, schema: { params, body }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } });
  app.get(path, { schema: { params } }, forDevice(readPreferences));
  app.put(path, writes(tokenFields),
    forDevice((db, id, transport, body) => subscribe(db, id, transport, body, key, false), 204));
  app.patch(path + '/token', writes(tokenFields),
    forDevice((db, id, transport, body) => subscribe(db, id, transport, body, key, true), 204));
  app.patch(path, writes(preferenceFields), forDevice(savePreferences));
  app.delete(path, { schema: { params } }, forDevice(removeSubscription, 204));
}
