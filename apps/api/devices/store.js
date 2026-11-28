import { createHmac, randomInt } from 'node:crypto';
import { authRateLimit, uuidParams } from '../auth/staff-web.js';
import { invalid, plain, shape, text } from '../school-life/validation.js';

const storage = {
  parent: { table: 'parent_sessions', id: 'id', stable: 'id', owner: 'guardian_id', active: ' AND revoked_at IS NULL' },
  teacher: { table: 'teacher_sessions', id: 'public_id', stable: 'digest', owner: 'teacher_id', active: '' },
  direction: { table: 'direction_devices', id: 'public_id', stable: 'digest', owner: 'school_id', active: '' },
};
export const deviceCodePatterns = { parent: '^PA-[0-9]{8}$', teacher: '^EN-[0-9]{8}$', direction: '^DI-[0-9]{8}$' };
const prefixes = { parent: 'PA', teacher: 'EN', direction: 'DI' };

function owner(role, actor) {
  return (role === 'parent' ? actor.guardian_id : role === 'teacher' ? actor.teacher_id : actor.school_id);
}

function currentKey(role, actor) {
  return role === 'parent' ? actor.sessionId : role === 'teacher' ? actor.sessionDigest : actor.deviceDigest;
}

function digestFor(key, schoolId, role, code) {
  return createHmac('sha256', key).update(['device-pair', schoolId, role, code].join(':')).digest();
}

export function deviceMetadata(request) {
  const agent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 384) : '';
  const native = request.headers['x-open-cartable-platform'];
  const tablet = request.headers['x-open-cartable-device-type'] === 'tablet';
  if (native === 'ios' || /iPhone|iPad|iPod/i.test(agent)) return ['iOS', (tablet || /iPad/i.test(agent)) ? 'Tablette' : 'Mobile'];
  if (native === 'android' || /Android/i.test(agent)) return ['Android', (tablet || (/Android/i.test(agent) && !/Mobile/i.test(agent))) ? 'Tablette' : 'Mobile'];
  if (/Windows/i.test(agent)) return ['Windows', 'Ordinateur'];
  if (/Macintosh|Mac OS/i.test(agent)) return ['macOS', 'Ordinateur'];
  if (/ChromeOS|CrOS/i.test(agent)) return ['ChromeOS', 'Ordinateur'];
  if (/Linux/i.test(agent)) return ['Linux', 'Ordinateur'];
  return ['Non renseigné', 'Appareil'];
}

export async function markDevice(db, role, stable, metadata) {
  if (!stable) return;
  const { table, stable: key, active } = storage[role];
  await db.query(`
    UPDATE ${table} SET device_os=coalesce(device_os,$2),device_type=coalesce(device_type,$3),last_seen=statement_timestamp()
    WHERE ${key}=$1 AND expires_at>statement_timestamp() ${active}
      AND (last_seen IS NULL OR last_seen<statement_timestamp()-interval '5 minutes')
  `, [stable, ...metadata]);
}

const statuses = (config) => `school_id=$1 AND ${config.owner}=$2 AND expires_at>statement_timestamp() ${config.active}`;

export function registerAccountDevices(app, prefix, { role, authenticated, writes = {}, key }) {
  const path = prefix + '/devices';
  const config = storage[role];
  const { table, id, stable } = config;
  const accessible = statuses(config);
  const params = uuidParams('deviceId');

  app.get(path, authenticated(async (_request, db, actor) => {
    const { rows } = await db.query(`
      SELECT ${id} AS id,device_name AS name,device_os AS os,device_type AS type,last_seen AS "lastSeen",
        COALESCE(${stable}=$3,false) AS current
      FROM ${table} WHERE ${accessible} ORDER BY current DESC,last_seen DESC NULLS LAST,${id}
    `, [actor.school_id, owner(role, actor), currentKey(role, actor) ?? null]);
    const { rows: [school] } = await db.query('SELECT code FROM schools WHERE id=$1', [actor.school_id]);
    return { schoolCode: school.code, pairingAvailable: Boolean(key), devices: rows };
  }));

  app.put(path + '/:deviceId', { ...writes, schema: { params, body: shape({ name: text(60) }) } },
    authenticated(async (request, db, actor) => {
      const updated = await db.query(`UPDATE ${table} SET device_name=$4 WHERE ${accessible} AND ${id}=$3`,
        [actor.school_id, owner(role, actor), request.params.deviceId, plain(request.body.name, true)]);
      return updated.rowCount ? undefined : null;
    }, 204));

  app.delete(path + '/:deviceId', { ...writes, schema: { params } },
    authenticated(async ({ params: input }, db, actor) => {
      const values = [actor.school_id, owner(role, actor), input.deviceId, currentKey(role, actor) ?? null];
      const target = `${accessible} AND ${id}=$3 AND ${stable} IS DISTINCT FROM $4`;
      const result = await db.query(role === 'parent'
        ? `UPDATE ${table} SET revoked_at=statement_timestamp() WHERE ${target}`
        : `DELETE FROM ${table} WHERE ${target}`, values);
      if (!result.rowCount) return null;
      await db.query('DELETE FROM device_pairings WHERE school_id=$1 AND role=$2 AND source_device=$3',
        [actor.school_id, role, input.deviceId]);
    }, 204));

  app.post(path + '/pair', { ...writes, config: authRateLimit }, authenticated(async (_request, db, actor) => {
    if (!key) invalid(503);
    const actorId = owner(role, actor);
    const { rows: [current] } = await db.query(`
      SELECT ${id} AS id FROM ${table} WHERE ${accessible} AND ${stable}=$3
    `, [actor.school_id, actorId, currentKey(role, actor) ?? null]);
    if (!current) invalid(409);
    const code = prefixes[role] + '-' + String(randomInt(100_000_000)).padStart(8, '0');
    const { rows: [pair] } = await db.query(`
      INSERT INTO device_pairings (school_id,role,actor_id,source_device,digest,expires_at)
      VALUES ($1,$2,$3,$4,$5,statement_timestamp()+interval '5 minutes')
      ON CONFLICT (school_id,role,actor_id) DO UPDATE SET
        digest=excluded.digest,source_device=excluded.source_device,expires_at=excluded.expires_at
      RETURNING expires_at AS "expiresAt"
    `, [actor.school_id, role, actorId, current.id, digestFor(key, actor.school_id, role, code)]);
    return { code, ...pair };
  }));
}

export async function redeemDevicePair(db, key, role, schoolCode, code, issue) {
  if (!key) return null;
  const { rows: [school] } = await db.query('SELECT id FROM schools WHERE code=$1', [schoolCode]);
  if (!school) return null;
  const digest = digestFor(key, school.id, role, code);
  const { rows: [pair] } = await db.query(`
    SELECT actor_id,source_device FROM device_pairings WHERE school_id=$1 AND role=$2 AND digest=$3
      AND expires_at>statement_timestamp()
  `, [school.id, role, digest]);
  if (!pair) return null;

  const accounts = { parent: ['guardians', 'id', ' AND active'], teacher: ['teacher_accounts', 'id', ' AND password_hash IS NOT NULL'],
    direction: ['direction_accounts', 'school_id', ''] };
  const [table, id, condition] = accounts[role];
  const locked = await db.query(`SELECT 1 FROM ${table} WHERE school_id=$1 AND ${id}=$2${condition} FOR UPDATE`,
    [school.id, pair.actor_id]);
  if (!locked.rowCount) return null;
  const configuration = storage[role];
  const source = await db.query(`
    SELECT 1 FROM ${configuration.table}
    WHERE ${statuses(configuration)} AND ${configuration.id}=$3 FOR SHARE
  `, [school.id, pair.actor_id, pair.source_device]);
  if (!source.rowCount) return null;
  const current = await db.query(`
    SELECT 1 FROM device_pairings WHERE school_id=$1 AND role=$2 AND actor_id=$3 AND digest=$4
      AND expires_at>statement_timestamp() FOR UPDATE
  `, [school.id, role, pair.actor_id, digest]);
  if (!current.rowCount) return null;
  const session = await issue(school.id, pair.actor_id);
  if (!session || session.rejected) return session;
  await db.query('DELETE FROM device_pairings WHERE school_id=$1 AND role=$2 AND actor_id=$3 AND digest=$4',
    [school.id, role, pair.actor_id, digest]);
  return session;
}

export function purgeDevicePairings(pool) {
  return pool.query('DELETE FROM device_pairings WHERE expires_at<=statement_timestamp()');
}
