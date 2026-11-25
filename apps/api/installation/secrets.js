import { readFileSync } from 'node:fs';

export function readSecret(env, name) {
  const file = env[name + '_FILE'];
  if (!file) return env[name];
  if (env[name] !== undefined) throw new Error(`Utilisez ${name} ou ${name}_FILE.`);
  return readFileSync(file, 'utf8').trim();
}
