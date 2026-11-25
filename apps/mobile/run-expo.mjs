import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
