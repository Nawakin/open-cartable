const lastRoleKey = 'open-cartable-access-role';

export async function lastAccessRole() {
  try { return localStorage.getItem(lastRoleKey); } catch { return null; }
}

export async function rememberAccessRole(role) {
  try {
    if (role) localStorage.setItem(lastRoleKey, role);
    else localStorage.removeItem(lastRoleKey);
  } catch { /* La session reste disponible dans le cookie. */ }
}

export async function lastSchoolAddress() { return ''; }
export async function rememberSchoolAddress() {}
