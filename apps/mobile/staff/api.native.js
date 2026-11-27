import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { parseSchoolAddress, requestJson, RequestError } from '../parent/http';
import { rememberSchoolAddress } from '../access/remember';

export const staffNeedsSchoolAddress = true;
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const key = (role) => 'open-cartable-staff-' + role;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function staffProfile(role) {
  const saved = await SecureStore.getItemAsync(key(role), options);
  if (!saved) return null;
  try {
    const profile = JSON.parse(saved);
    if (parseSchoolAddress(profile.origin ?? '') !== profile.origin) return null;
    return {
      origin: profile.origin, schoolCode: profile.schoolCode,
      ...(tokenPattern.test(profile.token ?? '') ? { token: profile.token } : {}),
      ...(tokenPattern.test(profile.deviceToken ?? '') ? { deviceToken: profile.deviceToken } : {}),
    };
  } catch {
    return null;
  }
}

export async function staffRequest(role, path, { origin, ...requestOptions } = {}) {
  const profile = await staffProfile(role);
  const address = origin ?? profile?.origin;
  if (!address || parseSchoolAddress(address) !== address) throw new RequestError(401);
  const sameSchoolServer = address === profile?.origin;
  const result = await requestJson(fetch, address + '/api/v1/' + role + path, {
    ...requestOptions, nativeStaff: true, attachmentAsBytes: true,
    token: sameSchoolServer ? profile.token : undefined,
    device: sameSchoolServer && path.startsWith('/auth/') ? profile.deviceToken : undefined,
  });
  const createsSession = ['/auth/login', '/auth/claim', '/auth/resume'].includes(path)
    || (path === '/auth/enrollment' && requestOptions.method === 'PUT');
  const schoolCode = requestOptions.body?.schoolCode ?? (sameSchoolServer ? profile.schoolCode : undefined);
  if (createsSession && tokenPattern.test(result?.token ?? '')) {
    await SecureStore.setItemAsync(key(role), JSON.stringify({
      origin: address, schoolCode, token: result.token,
      ...(result.deviceToken ? { deviceToken: result.deviceToken } : {}),
    }), options);
    await rememberSchoolAddress(address);
  } else if (path === '/auth/logout') {
    await SecureStore.setItemAsync(key(role), JSON.stringify({ origin: address, schoolCode }), options);
  }
  return result;
}
