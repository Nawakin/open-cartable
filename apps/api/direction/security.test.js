import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';
const email = 'direction@ecole.example';

test('la récupération vérifie l’adresse et protège le compte avec des liens et des codes à usage unique',
  { skip: !databaseUrl }, async (context) => {
    const schema = 'direction_security_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
    const sent = [];
    const mailer = async (address, purpose, token) => { sent.push({ address, purpose, token }); };
    const app = buildApp({ direction: { pool, webOrigin: origin, totpKey: randomBytes(32), mailer } });
    context.after(async () => {
      await app.close();
      await pool.end();
      try {
        await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      } finally {
        await admin.end();
      }
    });
    await admin.query('CREATE SCHEMA ' + schema);
    await migrate(pool);
    await seedDemo(pool);
    const school = demo.school;
    const password = randomBytes(24).toString('base64url');
    const updated = randomBytes(24).toString('base64url');
    const recovered = randomBytes(24).toString('base64url');
    await transaction(pool, async (db) => setDirectionPassword(db, school.id, await hashPassword(password)));
    let requests = 0;
    const call = (method, path, payload, headers = {}) => app.inject({
      method, url: '/api/v1/direction' + path, payload,
      headers: { origin, ...headers }, remoteAddress: '192.0.2.' + (++requests),
    });
    const login = (value, code) => call('POST', '/auth/login', {
      schoolCode: school.code, password: value, ...(code ? { code } : {}),
    });
    const cookie = (response) => {
      assert.equal(response.statusCode, 204);
      return { cookie: response.headers['set-cookie'].split(';')[0] };
    };
    const requestLink = (address = email) => call('POST', '/recovery/request', { schoolCode: school.code, email: address });
    const reset = (token, value, code) => call('POST', '/recovery/reset', { token, password: value, ...(code ? { code } : {}) });
    const link = (purpose) => {
      const message = sent.at(-1);
      assert.equal(message.purpose, purpose);
      assert.equal(message.address, email);
      return message.token;
    };
    const assertRequested = (result) => {
      assert.equal(result.statusCode, 202);
      assert.deepEqual(result.json(), { requested: true });
    };

    const initial = cookie(await login(password));
    const security = await call('GET', '/security', undefined, initial);
    assert.deepEqual(security.json(), { email: null, verified: false, totpEnabled: false, mailAvailable: true, totpAvailable: true });
    assert.equal(security.headers['cache-control'], 'no-store');
    assert.equal((await call('PUT', '/security/email', { email, password: updated }, initial)).statusCode, 422);
    assert.equal((await call('PUT', '/security/email', { email, password }, { ...initial, origin: 'https://ailleurs.example' })).statusCode, 403);
    assert.equal((await call('PUT', '/security/email', { email, password }, initial)).json().verified, false);
    assertRequested(await requestLink());
    assert.equal(sent.length, 0);
    const verification = await call('POST', '/security/email/verify', undefined, initial);
    assert.equal(verification.statusCode, 200);
    const verifyToken = link('verify');
    const { rows: [stored] } = await pool.query("SELECT digest FROM direction_recovery_tokens WHERE purpose = 'verify'");
    assert.notEqual(stored.digest.toString('base64url'), verifyToken);
    assert.equal((await reset(verifyToken, updated)).statusCode, 400);
    assert.equal((await call('POST', '/recovery/verify', { token: verifyToken })).statusCode, 204);
    assert.equal((await call('POST', '/recovery/verify', { token: verifyToken })).statusCode, 400);
    assertRequested(await requestLink('voisine@ecole.example'));
    assert.equal(sent.length, 1);
    assertRequested(await requestLink());
    const resetToken = link('reset');
    assertRequested(await requestLink());
    assert.equal(sent.length, 2);
    const attempts = await Promise.all([reset(resetToken, updated), reset(resetToken, updated)]);
    assert.deepEqual(attempts.map(({ statusCode }) => statusCode).sort(), [204, 400]);
    assert.equal((await call('GET', '/classes', undefined, initial)).statusCode, 401);
    assert.equal((await login(password)).statusCode, 401);

    const account = cookie(await login(updated));
    const otherSession = cookie(await login(updated));
    const prepared = await call('POST', '/security/totp', { password: updated }, account);
    assert.equal(prepared.statusCode, 200);
    const { uri, secret } = prepared.json();
    assert.ok(uri.startsWith('otpauth://totp/'));
    const totp = new TOTP({ secret: Secret.fromBase32(secret) });
    const code = (offset = 0) => totp.generate({ timestamp: Date.now() + offset * 30_000 });
    const activateCode = code(-1);
    assert.equal((await call('PUT', '/security/totp', { code: activateCode }, otherSession)).statusCode, 409);
    assert.equal((await call('PUT', '/security/totp', { code: activateCode }, account)).json().totpEnabled, true);
    assert.equal((await call('GET', '/classes', undefined, otherSession)).statusCode, 401);
    assert.equal((await login(updated)).statusCode, 428);
    assert.equal((await login(updated, activateCode)).statusCode, 401);
    const loginCode = code();
    const authenticated = cookie(await login(updated, loginCode));
    assert.equal((await login(updated, loginCode)).statusCode, 401);
    assert.equal((await call('PUT', '/security/email', { email: 'autre@ecole.example', password: updated }, authenticated)).statusCode, 422);
    const { rows: [protectedAccount] } = await pool.query('SELECT totp_secret FROM direction_accounts WHERE school_id = $1', [school.id]);
    assert.equal(protectedAccount.totp_secret.includes(Buffer.from(secret)), false);
    assertRequested(await requestLink());
    const protectedReset = link('reset');
    assert.equal((await reset(protectedReset, recovered)).statusCode, 428);
    assert.equal((await reset(protectedReset, recovered, loginCode)).statusCode, 400);
    assert.equal((await reset(protectedReset, recovered, code(1))).statusCode, 204);
    assert.equal((await call('GET', '/classes', undefined, authenticated)).statusCode, 401);
    assert.equal((await login(updated)).statusCode, 401);
    assert.equal((await login(recovered)).statusCode, 428);
  });
