const parentPath = '/api/v1/parent';

export function homeworkPath(childId, { from, to, domain, cursor }) {
  const search = new URLSearchParams({ from, to });
  if (domain) search.set('domain', domain);
  if (cursor) search.set('cursor', cursor);
  return `/children/${encodeURIComponent(childId)}/homework?${search.toString()}`;
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

export async function request(fetcher, origin, path, { method = 'GET', body, token, credentials } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(origin + parentPath + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new RequestError(response.status);
    return response.status === 204 ? undefined : await response.json();
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
