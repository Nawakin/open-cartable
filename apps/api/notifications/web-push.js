import { createECDH } from 'node:crypto';
import { sendNotification } from 'web-push';
import { openPrivateFile, sealPrivateFile } from '../files/private-files.js';

const path = '/parent/web/notifications';
const base64url = '^[A-Za-z0-9_-]+$';
const subscriptionBody = {
  type: 'object', additionalProperties: false, required: ['endpoint', 'p256dh', 'auth'],
  properties: {
    endpoint: { type: 'string', minLength: 30, maxLength: 1500 },
    p256dh: { type: 'string', pattern: base64url, minLength: 87, maxLength: 87 },
    auth: { type: 'string', pattern: base64url, minLength: 22, maxLength: 22 },
  },
};

function allowedEndpoint(endpoint) {
  const url = URL.parse(endpoint);
  if (!url || url.href !== endpoint || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || url.search || url.pathname.length < 10) return false;
  return (url.hostname === 'fcm.googleapis.com' && url.pathname.startsWith('/fcm/send/'))
    || (url.hostname === 'updates.push.services.mozilla.com' && url.pathname.startsWith('/wpush/'))
    || url.hostname === 'web.push.apple.com';
}

export function webPushSettings(hex, webOrigin) {
  if (!webOrigin || hex === undefined) return undefined;
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('La clé Web Push est invalide.');
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const scalar = BigInt('0x' + hex) % (order - 1n) + 1n;
  const key = Buffer.from(hex, 'hex');
  const privateKey = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);
  const publicKey = ecdh.getPublicKey().toString('base64url');
  return { key, vapidDetails: { subject: webOrigin, publicKey, privateKey: privateKey.toString('base64url') } };
}

export function registerParentPush(app, authenticated, requireWebOrigin, { key, vapidDetails }) {
  app.get(path, authenticated(async (_request, db, _actor, _reply, { sessionId }) => {
    const found = await db.query('SELECT 1 FROM parent_push_subscriptions WHERE session_id = $1', [sessionId]);
    return { enabled: Boolean(found.rowCount), publicKey: vapidDetails.publicKey };
  }));
  app.put(path, { onRequest: requireWebOrigin, bodyLimit: 2048, schema: { body: subscriptionBody },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, authenticated(async ({ body }, db, _actor, _reply, { sessionId }) => {
    if (!allowedEndpoint(body.endpoint) || Buffer.from(body.p256dh, 'base64url')[0] !== 4) {
      throw Object.assign(new Error('Abonnement de navigateur invalide.'), { statusCode: 400 });
    }
    const bytes = sealPrivateFile(Buffer.from(JSON.stringify(body)), key, ['web-push', sessionId]);
    await db.query(`
      INSERT INTO parent_push_subscriptions (session_id, subscription) VALUES ($1, $2)
      ON CONFLICT (session_id) DO UPDATE SET subscription = excluded.subscription,
        notified_at = statement_timestamp(), attempted_at = '-infinity'
    `, [sessionId, bytes]);
  }, 204));
  app.delete(path, { onRequest: requireWebOrigin }, authenticated(async (_request, db, _actor, _reply, { sessionId }) => {
    await db.query('DELETE FROM parent_push_subscriptions WHERE session_id = $1', [sessionId]);
  }, 204));
}

async function claim(pool) {
  const { rows } = await pool.query(`
    WITH due AS (
      SELECT p.session_id FROM parent_push_subscriptions p
      JOIN parent_sessions s ON s.id = p.session_id
      JOIN guardians g ON (g.school_id,g.id) = (s.school_id,s.guardian_id)
      WHERE s.revoked_at IS NULL AND s.expires_at > statement_timestamp() AND g.active
        AND p.attempted_at < statement_timestamp() - interval '1 minute'
        AND EXISTS (
          SELECT 1 FROM parent_push_events e
          JOIN guardian_students link ON (link.school_id,link.guardian_id) = (s.school_id,s.guardian_id)
          JOIN students st ON (st.school_id,st.id) = (link.school_id,link.student_id) AND st.left_at IS NULL
          WHERE e.school_id = s.school_id AND e.created_at > p.notified_at
            AND e.created_at > statement_timestamp() - interval '15 minutes'
            AND (e.class_id IS NULL OR e.class_id = st.class_id)
            AND (e.guardian_id IS NULL OR (e.guardian_id,e.student_id) = (s.guardian_id,st.id))
        )
      ORDER BY p.attempted_at, p.session_id LIMIT 25 FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE parent_push_subscriptions p SET attempted_at = date_trunc('milliseconds', statement_timestamp())
    FROM due WHERE due.session_id = p.session_id RETURNING p.session_id, p.subscription, p.attempted_at
  `);
  return rows;
}

export async function purgeParentPush(pool) {
  await pool.query(`
    DELETE FROM parent_push_subscriptions p USING parent_sessions s
    WHERE p.session_id = s.id AND (s.revoked_at IS NOT NULL OR s.expires_at <= statement_timestamp())
  `);
  await pool.query("DELETE FROM parent_push_events WHERE created_at <= statement_timestamp() - interval '15 minutes'");
}

export async function dispatchParentPush(pool, { key, vapidDetails }, send = sendNotification) {
  await purgeParentPush(pool);
  const rows = await claim(pool);
  await Promise.all(rows.map(async ({ session_id: id, subscription, attempted_at: at }) => {
    try {
      const { endpoint, p256dh, auth } = JSON.parse(openPrivateFile(subscription, key, ['web-push', id]).toString());
      if (!allowedEndpoint(endpoint)) return;
      await send({ endpoint, keys: { p256dh, auth } }, 'nouveaute', { vapidDetails, TTL: 300, timeout: 5000, topic: 'open-cartable' });
      await pool.query('UPDATE parent_push_subscriptions SET notified_at = attempted_at WHERE (session_id,attempted_at) = ($1,$2)',
        [id, at]);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pool.query('DELETE FROM parent_push_subscriptions WHERE (session_id,attempted_at) = ($1,$2)', [id, at]);
      }
    }
  }));
}

export function startParentPush(pool, settings) {
  let pending;
  function run() {
    if (pending) return;
    pending = dispatchParentPush(pool, settings).catch(() => {
      console.error('Le traitement des notifications web sera réessayé.');
    }).finally(() => { pending = undefined; });
  }
  const timer = setInterval(run, 15_000);
  timer.unref();
  return async () => { clearInterval(timer); await pending; };
}
