import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { connect, createServer } from 'node:http2';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import { createApnsTransport, createFcmTransport } from './native-providers.js';

test('FCM signe la demande OAuth et envoie des alertes génériques par le point de terminaison Google', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const document = JSON.stringify({
    type: 'service_account', project_id: 'ecole-fictive', client_email: 'test@ecole-fictive.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://ailleurs.example/',
  });
  const calls = [];
  const requests = [];
  let unregistered = false;
  const transport = createFcmTransport(document, {
    async fetcher(url, options) {
      calls.push(url);
      assert.equal(options.redirect, 'error');
      if (url === 'https://oauth2.googleapis.com/token') {
        const { payload } = await jwtVerify(options.body.get('assertion'), publicKey, { audience: url, algorithms: ['RS256'] });
        assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');
        assert.equal(payload.iss, 'test@ecole-fictive.iam.gserviceaccount.com');
        return Response.json({ access_token: 'jeton-fictif', expires_in: 3600 });
      }
      assert.equal(url, 'https://fcm.googleapis.com/v1/projects/ecole-fictive/messages:send');
      assert.equal(options.headers.Authorization, 'Bearer jeton-fictif');
      requests.push(JSON.parse(options.body).message);
      if (unregistered) return Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
      return Response.json({ name: 'fictif' });
    },
  });
  const options = { TTL: 300, topic: 'oc-attendance' };
  await Promise.all([transport.send('A'.repeat(64), 'attendance', options), transport.send('B'.repeat(64), 'attendance', options)]);
  assert.equal(calls.filter((url) => url.endsWith('/token')).length, 1);
  assert.deepEqual(requests[0].data, { destination: 'attendance' });
  assert.equal(requests[0].android.notification.channel_id, 'school-updates');
  assert.equal(requests[0].android.ttl, '300s');
  unregistered = true;
  await assert.rejects(transport.send('A'.repeat(64), 'attendance', options), { statusCode: 410 });
});

test('APNs transmet un jeton de fournisseur signé et réutilise la connexion HTTP/2', async (context) => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const server = createServer();
  const received = [];
  let connections = 0;
  let status = 200;
  server.on('stream', (stream, headers) => {
    stream.setEncoding('utf8');
    let body = '';
    stream.on('data', (part) => { body += part; });
    stream.on('end', () => {
      received.push({ headers, body: JSON.parse(body) });
      stream.respond({ ':status': status, 'content-type': 'application/json' });
      stream.end(status === 410 ? '{"reason":"Unregistered"}' : '');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const transport = createApnsTransport({
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), teamId: 'ABCDEFGHIJ', keyId: '0123456789',
    bundleId: 'fr.ecole.exemple', environment: 'sandbox',
  }, {
    connector(origin) {
      assert.equal(origin, 'https://api.sandbox.push.apple.com');
      connections += 1;
      return connect('http://127.0.0.1:' + server.address().port);
    },
  });
  context.after(() => { transport.close(); server.close(); });
  const token = 'ab'.repeat(32);
  const options = { TTL: 300, topic: 'oc-agenda' };
  await transport.send(token, 'agenda-reminder', options);
  status = 410;
  await assert.rejects(transport.send(token, 'agenda-reminder', options), { statusCode: 410 });
  assert.equal(connections, 1);
  const [{ headers, body }] = received;
  assert.equal(headers[':path'], '/3/device/' + token);
  assert.equal(headers['apns-topic'], 'fr.ecole.exemple');
  assert.equal(headers['apns-push-type'], 'alert');
  const verified = await jwtVerify(headers.authorization.slice(7), publicKey, { issuer: 'ABCDEFGHIJ', algorithms: ['ES256'] });
  assert.equal(verified.protectedHeader.kid, '0123456789');
  assert.equal(body.destination, 'agenda-reminder');
  assert.equal(Object.keys(body).length, 2);
});
