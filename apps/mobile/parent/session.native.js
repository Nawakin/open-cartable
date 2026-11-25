import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { agendaPath, homeworkPath, parseSchoolAddress, request } from './http';

const storageKey = 'open-cartable-parent-session';
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let current;
let refreshing;

export const needsSchoolAddress = true;

async function remember(origin, { accessToken, refreshToken }) {
  await SecureStore.setItemAsync(storageKey, JSON.stringify({ origin, refreshToken }), storageOptions);
  current = { origin, accessToken, refreshToken };
  return current;
}

async function forget() {
  current = undefined;
  await SecureStore.deleteItemAsync(storageKey, storageOptions);
}

async function restore() {
  if (current) return current;
  const saved = await SecureStore.getItemAsync(storageKey, storageOptions);
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

function refresh(session) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const result = await request(fetch, session.origin, '/auth/refresh', {
        method: 'POST', body: { refreshToken: session.refreshToken },
      });
      return await remember(session.origin, result);
    } catch (error) {
      // Une réponse perdue peut avoir consommé le jeton. Éviter de le réutiliser.
      if (error.status === 429) throw error;
      await forget();
      return null;
    }
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

export async function signIn({ origin, schoolCode, code }) {
  const result = await request(fetch, origin, '/auth/invitations/redeem', {
    method: 'POST', body: { schoolCode, code },
  });
  await remember(origin, result);
}

async function withSession(operation) {
  let session = await restore();
  if (!session) return null;
  if (!session.accessToken) {
    session = await refresh(session);
    return session ? operation(session) : null;
  }
  try {
    return await operation(session);
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refresh(session);
    return renewed ? operation(renewed) : null;
  }
}

async function get(path) {
  try {
    return await withSession(({ origin, accessToken }) => request(fetch, origin, path, { token: accessToken }));
  } catch (error) {
    if (error.status !== 401) throw error;
    await forget();
    return null;
  }
}

export async function listChildren() {
  return (await get('/children'))?.children ?? null;
}

export function listHomework(childId, period) {
  return get(homeworkPath(childId, period));
}

export function listAgenda(childId, period) {
  return get(agendaPath(childId, period));
}

export async function signOut() {
  const session = await restore();
  if (session) {
    await request(fetch, session.origin, '/auth/logout', {
      method: 'POST', body: { refreshToken: session.refreshToken },
    });
  }
  await forget();
}
