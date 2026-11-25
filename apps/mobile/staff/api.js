import { requestJson } from '../parent/http';

export function staffRequest(role, path, options) {
  return requestJson(fetch, '/api/v1/' + role + path, {
    ...options, credentials: 'same-origin', cache: 'no-store',
  });
}

export function classPath(classId) {
  return `/classes/${encodeURIComponent(classId)}/homework`;
}
