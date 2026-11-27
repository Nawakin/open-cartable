import { createECDH } from 'node:crypto';
import { sendNotification } from 'web-push';
import { openPrivateFile, sealPrivateFile } from '../files/private-files.js';

const path = '/parent/web/notifications';
const categories = ['homework', 'messages', 'liaison', 'blog', 'agenda', 'attendance'];
const payloadVersionBody = { const: 2 };
const preferencesBody = { anyOf: [{
  type: 'object', additionalProperties: false, required: ['categories', 'weekends'],
  properties: {
    categories: { type: 'array', maxItems: categories.length, uniqueItems: true, items: { enum: categories } },
    weekends: { type: 'boolean' },
  },
}, {
  type: 'object', additionalProperties: false, required: ['payloadVersion'],
  properties: { payloadVersion: payloadVersionBody },
}] };
const base64url = '^[A-Za-z0-9_-]+$';
const subscriptionBody = {
  type: 'object', additionalProperties: false, required: ['endpoint', 'p256dh', 'auth'],
  properties: {
    endpoint: { type: 'string', minLength: 30, maxLength: 1500 },
    p256dh: { type: 'string', pattern: base64url, minLength: 87, maxLength: 87 },
    auth: { type: 'string', pattern: base64url, minLength: 22, maxLength: 22 },
    payloadVersion: payloadVersionBody,
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
    const { rows: [preferences] } = await db.query(`
      SELECT categories, weekends, payload_version AS "payloadVersion"
      FROM parent_push_subscriptions WHERE session_id = $1
    `, [sessionId]);
    return { enabled: Boolean(preferences), publicKey: vapidDetails.publicKey,
      ...(preferences ?? { categories, weekends: true, payloadVersion: 2 }) };
  }));
  app.put(path, { onRequest: requireWebOrigin, bodyLimit: 2048, schema: { body: subscriptionBody },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, authenticated(async ({ body }, db, _actor, _reply, { sessionId }) => {
    if (!allowedEndpoint(body.endpoint) || Buffer.from(body.p256dh, 'base64url')[0] !== 4) {
      throw Object.assign(new Error('Abonnement de navigateur invalide.'), { statusCode: 400 });
    }
    const { endpoint, p256dh, auth, payloadVersion = 1 } = body;
    const bytes = sealPrivateFile(Buffer.from(JSON.stringify({ endpoint, p256dh, auth })), key, ['web-push', sessionId]);
    await db.query(`
      INSERT INTO parent_push_subscriptions (session_id, subscription, payload_version) VALUES ($1, $2, $3)
      ON CONFLICT (session_id) DO UPDATE SET subscription = excluded.subscription,
        payload_version = GREATEST(parent_push_subscriptions.payload_version, excluded.payload_version),
        attempted_at = '-infinity'
    `, [sessionId, bytes, payloadVersion]);
  }, 204));
  app.patch(path, { onRequest: requireWebOrigin, bodyLimit: 1024, schema: { body: preferencesBody } },
    authenticated(async ({ body }, db, _actor, _reply, { sessionId }) => {
      const preferences = await db.query(`
        UPDATE parent_push_subscriptions
        SET categories = COALESCE($2, categories), weekends = COALESCE($3, weekends),
          payload_version = COALESCE($4, payload_version)
        WHERE session_id = $1 RETURNING categories, weekends, payload_version AS "payloadVersion"
      `, [sessionId, body.categories ?? null, body.weekends ?? null, body.payloadVersion ?? null]);
      return preferences.rows[0] ?? null;
    }));
  app.delete(path, { onRequest: requireWebOrigin }, authenticated(async (_request, db, _actor, _reply, { sessionId }) => {
    await db.query('DELETE FROM parent_push_subscriptions WHERE session_id = $1', [sessionId]);
  }, 204));
}

async function claim(pool) {
  const { rows } = await pool.query(`
    WITH due AS (
      SELECT p.session_id, events.ids, events.kinds FROM parent_push_subscriptions p
      JOIN parent_sessions s ON s.id = p.session_id
      JOIN guardians g ON (g.school_id,g.id) = (s.school_id,s.guardian_id)
      CROSS JOIN LATERAL (
        SELECT array_agg(e.id ORDER BY e.deliver_after DESC, e.id DESC) AS ids,
          array_agg(e.kind ORDER BY e.deliver_after DESC, e.id DESC) AS kinds
        FROM (
          SELECT e.id, e.kind, e.deliver_after FROM parent_push_events e
          WHERE e.school_id = s.school_id AND e.deliver_after > p.subscribed_at
            AND e.deliver_after <= statement_timestamp() AND e.deliver_until > statement_timestamp()
            AND (p.weekends OR (
              EXTRACT(ISODOW FROM e.deliver_after AT TIME ZONE 'Europe/Paris') <= 5
              AND EXTRACT(ISODOW FROM statement_timestamp() AT TIME ZONE 'Europe/Paris') <= 5
            ))
            AND CASE e.kind
              WHEN 'agenda-reminder' THEN 'agenda' = ANY(p.categories)
              WHEN 'general' THEN cardinality(p.categories) > 0
              ELSE e.kind = ANY(p.categories)
            END
            AND NOT EXISTS (
              SELECT 1 FROM parent_push_deliveries d WHERE (d.session_id, d.event_id) = (p.session_id, e.id)
            )
            AND (e.absence_day IS NULL OR EXISTS (
              SELECT 1 FROM attendance_entries a
              WHERE (a.school_id,a.class_id,a.day,a.student_id) = (e.school_id,e.class_id,e.absence_day,e.student_id)
                AND a.status = 'absent' AND NOT a.justified AND NOT EXISTS (
                  SELECT 1 FROM absence_justifications j
                  WHERE (j.school_id,j.class_id,j.day,j.student_id) = (a.school_id,a.class_id,a.day,a.student_id)
                    AND j.status IN ('pending','accepted')
                )
            ))
            AND EXISTS (
              SELECT 1 FROM guardian_students link
              JOIN students st ON (st.school_id,st.id) = (link.school_id,link.student_id) AND st.left_at IS NULL
              WHERE (link.school_id,link.guardian_id) = (s.school_id,s.guardian_id)
                AND (e.class_id IS NULL OR e.class_id = st.class_id OR e.absence_day IS NOT NULL)
                AND (e.guardian_id IS NULL OR e.guardian_id = s.guardian_id)
                AND (e.student_id IS NULL OR e.student_id = st.id)
            )
          ORDER BY e.deliver_after DESC, e.id DESC LIMIT 128
        ) e
      ) events
      WHERE s.revoked_at IS NULL AND s.expires_at > statement_timestamp() AND g.active
        AND p.attempted_at < statement_timestamp() - interval '1 minute'
        AND events.ids IS NOT NULL
      ORDER BY p.attempted_at, p.session_id LIMIT 25 FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE parent_push_subscriptions p SET attempted_at = date_trunc('milliseconds', statement_timestamp())
    FROM due WHERE due.session_id = p.session_id
    RETURNING p.session_id, p.subscription, p.attempted_at, p.payload_version, due.ids, due.kinds
  `);
  return rows;
}

export async function purgeParentPush(pool) {
  await pool.query(`
    DELETE FROM parent_push_subscriptions p USING parent_sessions s
    WHERE p.session_id = s.id AND (s.revoked_at IS NOT NULL OR s.expires_at <= statement_timestamp())
  `);
  await pool.query('DELETE FROM parent_push_events WHERE deliver_until <= statement_timestamp()');
}

function notifications({ ids, kinds, payload_version: version }) {
  if (version === 1) return [{ kind: 'nouveaute', topic: 'open-cartable', ids }];
  const groups = new Map();
  for (const [index, kind] of kinds.entries()) {
    const category = kind === 'agenda-reminder' ? 'agenda' : kind;
    if (!groups.has(category)) groups.set(category, { kind: kind === 'general' ? 'nouveaute' : kind, topic: 'oc-' + category, ids: [] });
    groups.get(category).ids.push(ids[index]);
  }
  return groups.values();
}

export async function dispatchParentPush(pool, { key, vapidDetails }, send = sendNotification) {
  await purgeParentPush(pool);
  const rows = await claim(pool);
  await Promise.all(rows.map(async (row) => {
    const { session_id: id, subscription, attempted_at: at } = row;
    try {
      const { endpoint, p256dh, auth } = JSON.parse(openPrivateFile(subscription, key, ['web-push', id]).toString());
      if (!allowedEndpoint(endpoint)) return;
      for (const { kind, topic, ids } of notifications(row)) {
        await send({ endpoint, keys: { p256dh, auth } }, kind, { vapidDetails, TTL: 300, timeout: 5000, topic });
        await pool.query(`
          INSERT INTO parent_push_deliveries (session_id, event_id)
          SELECT p.session_id, e.id FROM parent_push_subscriptions p CROSS JOIN parent_push_events e
          WHERE (p.session_id,p.attempted_at) = ($1,$2) AND e.id = ANY($3::bigint[])
          ON CONFLICT DO NOTHING
        `, [id, at, ids]);
      }
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
