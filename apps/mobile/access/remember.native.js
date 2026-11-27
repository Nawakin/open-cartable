import * as SecureStore from 'expo-secure-store';
import { parseSchoolAddress } from '../parent/http';

const lastRoleKey = 'open-cartable-access-role';
const addressKey = 'open-cartable-school-address';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function lastAccessRole() {
  return SecureStore.getItemAsync(lastRoleKey, options);
}

export function rememberAccessRole(role) {
  return role ? SecureStore.setItemAsync(lastRoleKey, role, options) : SecureStore.deleteItemAsync(lastRoleKey, options);
}

export async function lastSchoolAddress() {
  return parseSchoolAddress(await SecureStore.getItemAsync(addressKey, options) ?? '') ?? '';
}

export function rememberSchoolAddress(origin) {
  if (origin) return SecureStore.setItemAsync(addressKey, origin, options);
}
