import { Dimensions, Platform } from 'react-native';

const parentPath = '/api/v1/parent';

export function homeworkPath(childId, { from, to, domain, cursor, kind }) {
  const search = new URLSearchParams({ from, to });
  if (domain) search.set('domain', domain);
  if (cursor) search.set('cursor', cursor);
  if (kind) search.set('kind', kind);
  return `/children/${encodeURIComponent(childId)}/homework?${search.toString()}`;
}

export function agendaPath(childId, { from, until, cursor }) {
  const search = new URLSearchParams({ from, until });
  if (cursor) search.set('cursor', cursor);
  return `/children/${encodeURIComponent(childId)}/agenda?${search.toString()}`;
}

export function agendaRemindersPath(cursor) {
  const path = '/agenda/reminders';
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export class RequestError extends Error {
  constructor(status) {
    super('La demande n’a pas abouti.');
    this.status = status;
  }
}

export function parseSchoolAddress(address) {
  try {
    const url = new URL(address.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function request(fetcher, origin, path, options) {
  return requestJson(fetcher, origin + parentPath + path, options);
}

export async function requestJson(fetcher, url, {
  method = 'GET', body, token, credentials, cache, binary = false, responseType = 'json', timeoutMs, attachmentAsBytes = false,
  nativeStaff = false, device,
} = {}) {
  const accept = { bytes: 'image/jpeg', pdf: 'application/pdf', attachment: '*/*' };
  const headers = { Accept: accept[responseType] ?? 'application/json' };
  if (body !== undefined) headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    headers['X-Open-Cartable-Platform'] = Platform.OS;
    const { width, height } = Dimensions.get('screen');
    headers['X-Open-Cartable-Device-Type'] = (Platform.isPad || Math.min(width, height) >= 600) ? 'tablet' : 'mobile';
  }
  if (nativeStaff) {
    headers['X-Open-Cartable-Client'] = 'native';
    if (device) headers['X-Open-Cartable-Device'] = device;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ??
    (binary || responseType === 'pdf' || responseType === 'attachment' ? 60_000 : 12_000));
  try {
    const response = await fetcher(url, {
      method,
      headers,
      body: binary || body === undefined ? body : JSON.stringify(body),
      credentials,
      cache,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new RequestError(response.status);
    if (response.status === 204) return undefined;
    if (responseType === 'bytes') return await response.arrayBuffer();
    if (responseType === 'pdf' || responseType === 'attachment') {
      if (!attachmentAsBytes) return await response.blob();
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
      return { type, bytes: new Uint8Array(await response.arrayBuffer()) };
    }
    return await response.json();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(0);
  } finally {
    clearTimeout(timeout);
  }
}

export function errorMessage(error) {
  switch (error.status) {
    case 0: return 'Le serveur de l’école est inaccessible. Vérifiez votre connexion et réessayez.';
    case 400: return 'Vérifiez le format des codes saisis.';
    case 401: return 'Les codes sont invalides ou ont expiré. Contactez votre école si besoin.';
    case 429: return 'Trop de tentatives. Réessayez dans une minute.';
    default: return 'L’opération a échoué. Réessayez dans un instant.';
  }
}
