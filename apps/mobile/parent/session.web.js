import { homeworkPath, request } from './http';

export const needsSchoolAddress = false;

export async function signIn({ schoolCode, code }) {
  await request(fetch, '', '/web/auth/login', { method: 'POST', body: { schoolCode, code }, credentials: 'same-origin' });
}

async function get(path) {
  try {
    return await request(fetch, '', path, { credentials: 'same-origin' });
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function listChildren() {
  return (await get('/children'))?.children ?? null;
}

export function listHomework(childId, period) {
  return get(homeworkPath(childId, period));
}

export async function signOut() {
  await request(fetch, '', '/web/auth/logout', { method: 'POST', credentials: 'same-origin' });
}
