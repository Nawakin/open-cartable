import { isIPv4 } from 'node:net';

export function privateLanIp(value) {
  if (typeof value !== 'string' || !isIPv4(value)) return false;
  const [first, second] = value.split('.').map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function installationOrigin(value) {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  if (!url || url.origin !== value) return null;
  if (url.protocol === 'https:') return url.origin;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) ? url.origin : null;
}
