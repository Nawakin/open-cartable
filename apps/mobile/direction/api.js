import { requestJson } from '../parent/http';

export function directionRequest(path, options) {
  return requestJson(fetch, '/api/v1/direction' + path, {
    ...options, credentials: 'same-origin', cache: 'no-store',
  });
}

export function classPath(classId) {
  return `/classes/${encodeURIComponent(classId)}/homework`;
}
