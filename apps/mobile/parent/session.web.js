import { request } from './http';

export const needsSchoolAddress = false;

export async function signIn({ schoolCode, code }) {
  await request(fetch, '', '/web/auth/login', { method: 'POST', body: { schoolCode, code }, credentials: 'same-origin' });
}

export async function listChildren() {
  try {
    const { children } = await request(fetch, '', '/children', { credentials: 'same-origin' });
    return children;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function signOut() {
  await request(fetch, '', '/web/auth/logout', { method: 'POST', credentials: 'same-origin' });
}
