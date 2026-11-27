import { requestJson } from '../parent/http';

export const staffNeedsSchoolAddress = false;
export async function staffProfile() { return null; }

export function staffRequest(role, path, options) {
  return requestJson(fetch, '/api/v1/' + role + path, {
    ...options, credentials: 'same-origin', cache: 'no-store',
  });
}
