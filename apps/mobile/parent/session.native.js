import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { agendaPath, agendaRemindersPath, homeworkPath, parseSchoolAddress, request, RequestError } from './http';

const storageKey = 'open-cartable-parent-session';
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let current;
let refreshing;
let sessionVersion = 0;
let signingOut = false;

export const needsSchoolAddress = true;

async function remember(origin, { accessToken, refreshToken }) {
  await SecureStore.setItemAsync(storageKey, JSON.stringify({ origin, refreshToken }), storageOptions);
  current = { origin, accessToken, refreshToken };
  return current;
}

async function forget() {
  sessionVersion += 1;
  current = undefined;
  await SecureStore.deleteItemAsync(storageKey, storageOptions);
}

async function restore() {
  if (current) return current;
  const version = sessionVersion;
  const saved = await SecureStore.getItemAsync(storageKey, storageOptions);
  if (version !== sessionVersion) return null;
  if (current) return current;
  if (!saved) return null;
  let previous;
  try {
    previous = JSON.parse(saved);
  } catch {
    await forget();
    return null;
  }
  if (typeof previous?.origin !== 'string' || parseSchoolAddress(previous.origin) !== previous.origin
      || typeof previous.refreshToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(previous.refreshToken)) {
    await forget();
    return null;
  }
  return previous;
}

function refresh(session, version) {
  if (signingOut || version !== sessionVersion) return null;
  if (refreshing) return refreshing;
  // Une autre requête peut avoir renouvelé le jeton pendant cette requête.
  if (current && current !== session) return current;
  refreshing = (async () => {
    try {
      const result = await request(fetch, session.origin, '/auth/refresh', {
        method: 'POST', body: { refreshToken: session.refreshToken },
      });
      return version === sessionVersion ? await remember(session.origin, result) : null;
    } catch (error) {
      // Une réponse perdue peut avoir consommé le jeton. Éviter de le réutiliser.
      if (error.status === 429) throw error;
      if (version === sessionVersion && !signingOut) await forget();
      return null;
    }
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

export async function signIn({ origin, schoolCode, code }) {
  const result = await request(fetch, origin, '/auth/invitations/redeem', {
    method: 'POST', body: { schoolCode, code },
  });
  sessionVersion += 1;
  await refreshing?.catch(() => {});
  await remember(origin, result);
}

async function withSession(operation) {
  const version = sessionVersion;
  const session = await restore();
  if (!session || signingOut || version !== sessionVersion) return null;
  if (session.accessToken) {
    try {
      const result = await operation(session);
      return !signingOut && version === sessionVersion ? result : null;
    } catch (error) {
      if (error.status !== 401) throw error;
    }
  }
  const renewed = await refresh(session, version);
  if (!renewed || signingOut || version !== sessionVersion) return null;
  const result = await operation(renewed);
  return !signingOut && version === sessionVersion ? result : null;
}

async function get(path, options) {
  const version = sessionVersion;
  try {
    return await withSession(({ origin, accessToken }) => request(fetch, origin, path,
      { ...options, token: accessToken, attachmentAsBytes: true }));
  } catch (error) {
    if (error.status !== 401) throw error;
    if (version === sessionVersion && !signingOut) await forget();
    return null;
  }
}

export async function listChildren() {
  return (await get('/children'))?.children ?? null;
}

export async function getTutorReference() {
  return (await get('/tutor-reference'))?.reference ?? null;
}

export function listHomework(childId, period) {
  return get(homeworkPath(childId, period));
}

export function listAgenda(childId, period) {
  return get(agendaPath(childId, period));
}

export function listAgendaReminders(cursor) {
  return get(agendaRemindersPath(cursor));
}

export async function requestParent(path, options) {
  const result = await get(path, options);
  if (result === null) throw new RequestError(401);
  return result;
}

export function requestMessages(path, options) {
  return requestParent('/messages' + path, options);
}

export async function signOut() {
  signingOut = true;
  try {
    await refreshing?.catch(() => {});
    const session = await restore();
    if (session) {
      await request(fetch, session.origin, '/auth/logout', {
        method: 'POST', body: { refreshToken: session.refreshToken },
      });
    }
    await forget();
  } finally {
    signingOut = false;
  }
}
