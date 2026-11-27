import { createPrivateKey } from 'node:crypto';
import { connect, constants } from 'node:http2';
import { SignJWT } from 'jose';
import { readSecret } from '../installation/secrets.js';

const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const title = 'Open Cartable';
const summaries = {
  nouveaute: 'Vous avez une nouveauté dans votre espace.',
  homework: 'Une nouvelle entrée est disponible dans le cahier de texte.',
  messages: 'Vous avez un nouveau message.',
  liaison: 'Un nouveau mot est disponible dans le cahier de liaison.',
  blog: 'Un nouvel article est disponible dans le blog de classe.',
  agenda: 'Un événement a été ajouté ou modifié dans l’agenda.',
  'agenda-reminder': 'Un événement de l’agenda approche.',
  attendance: 'Vérifiez le suivi des absences dans votre espace.',
};

function configuration(service) {
  return new Error('Configuration ' + service + ' des notifications natives invalide.');
}

function deliveryFailure(code = 503) {
  return Object.assign(new Error('Le service de notifications natives a refusé l’envoi.'), { statusCode: code });
}

function privateKey(pem, type, service) {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType === type) return key;
  } catch {
    // Ne pas exposer la clé ou le diagnostic du parseur.
  }
  throw configuration(service);
}

function cachedToken(issue, now) {
  let cached;
  let pending;
  return async () => {
    if (cached?.expiresAt > now()) return cached.value;
    pending ??= issue().then((result) => {
      cached = result;
      return result.value;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export function createFcmTransport(document, { fetcher = fetch, now = Date.now } = {}) {
  let account;
  try { account = JSON.parse(document); }
  catch { throw configuration('FCM'); }
  if (account?.type !== 'service_account' || typeof account.project_id !== 'string'
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.project_id)
      || typeof account.client_email !== 'string'
      || !/^[a-z0-9_.-]+@[a-z0-9_.-]+\.gserviceaccount\.com$/i.test(account.client_email)) throw configuration('FCM');
  const key = privateKey(account.private_key, 'rsa', 'FCM');
  if (key.asymmetricKeyDetails.modulusLength < 2048) throw configuration('FCM');
  const sendUrl = 'https://fcm.googleapis.com/v1/projects/' + account.project_id + '/messages:send';

  const authorization = cachedToken(async () => {
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(account.client_email).setAudience(googleTokenUrl)
      .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 600).sign(key);
    const response = await fetcher(googleTokenUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!response.ok) { await response.body?.cancel(); throw deliveryFailure(); }
    const result = await response.json();
    if (typeof result?.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in)) {
      throw deliveryFailure();
    }
    return { value: result.access_token, expiresAt: now() + Math.max(0, result.expires_in - 60) * 1000 };
  }, now);

  return {
    async send(token, kind, { topic, TTL }) {
      const accessToken = await authorization();
      const response = await fetcher(sendUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token, data: { destination: kind }, notification: { title, body: summaries[kind] },
            android: { priority: 'HIGH', ttl: TTL + 's', notification: { channel_id: 'school-updates', tag: topic } },
          },
        }),
      });
      if (response.ok) { await response.body?.cancel(); return; }
      const failure = await response.json().catch(() => null);
      if (response.status === 404 && failure?.error?.details?.some((detail) => detail?.errorCode === 'UNREGISTERED')) {
        throw deliveryFailure(410);
      }
      throw deliveryFailure();
    },
  };
}

function apnsRequest(client, headers, content) {
  return new Promise((resolve, reject) => {
    const request = client.request(headers);
    let status;
    let body = '';
    const timer = setTimeout(() => {
      request.close(constants.NGHTTP2_CANCEL);
      reject(deliveryFailure());
    }, 5000);
    request.setEncoding('utf8');
    request.on('response', (response) => { status = response[':status']; });
    request.on('data', (chunk) => {
      if (body.length < 4096) body += chunk.slice(0, 4096 - body.length);
    });
    request.on('error', () => reject(deliveryFailure()));
    request.on('end', () => {
      if (status === 200) resolve();
      else if (status === 410 && /"reason"\s*:\s*"Unregistered"/.test(body)) reject(deliveryFailure(410));
      else reject(deliveryFailure());
    });
    request.on('close', () => { clearTimeout(timer); reject(deliveryFailure()); });
    request.end(content);
  });
}

export function createApnsTransport(options, { connector = connect, now = Date.now } = {}) {
  const { pem, teamId, keyId, bundleId, environment } = options;
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '') || !/^[A-Z0-9]{10}$/.test(keyId ?? '')
      || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId ?? '') || bundleId.length > 255
      || !['production', 'sandbox'].includes(environment)) throw configuration('APNs');
  const key = privateKey(pem, 'ec', 'APNs');
  if (key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw configuration('APNs');
  const origin = environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';

  let client;
  function connection() {
    if (!client || client.destroyed || client.closed) {
      const next = connector(origin);
      next.on('error', () => next.destroy());
      next.setTimeout(30_000, () => next.close());
      client = next;
    }
    return client;
  }
  const authorization = cachedToken(async () => {
    const issuedAt = Math.floor(now() / 1000);
    const value = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId).setIssuedAt(issuedAt).sign(key);
    return { value, expiresAt: now() + 40 * 60_000 };
  }, now);

  return {
    async send(token, kind, { topic, TTL }) {
      const auth = await authorization();
      return apnsRequest(connection(), {
        ':method': 'POST', ':path': '/3/device/' + token,
        authorization: 'bearer ' + auth, 'content-type': 'application/json',
        'apns-topic': bundleId, 'apns-push-type': 'alert', 'apns-priority': '10',
        'apns-expiration': String(Math.floor(now() / 1000) + TTL), 'apns-collapse-id': topic,
      }, JSON.stringify({ aps: { alert: { title, body: summaries[kind] }, sound: 'default', 'thread-id': topic },
        destination: kind }));
    },
    close() { client?.destroy(); },
  };
}

export function nativePushTransports(env) {
  const transports = {};
  const fcm = readSecret(env, 'FCM_SERVICE_ACCOUNT');
  if (fcm !== undefined) transports.fcm = createFcmTransport(fcm);
  const pem = readSecret(env, 'APNS_KEY');
  const { APNS_TEAM_ID: teamId, APNS_KEY_ID: keyId, APNS_BUNDLE_ID: bundleId, APNS_ENVIRONMENT: environment } = env;
  if ([pem, teamId, keyId, bundleId, environment].some((value) => value !== undefined)) {
    transports.apns = createApnsTransport({ pem, teamId, keyId, bundleId, environment: environment ?? 'production' });
  }
  return transports;
}
