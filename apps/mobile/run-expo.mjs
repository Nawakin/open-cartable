import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
if (result.status === 0 && process.argv[2] === 'export' && process.argv.includes('web')) {
  const source = new URL('../', pathToFileURL(require.resolve('@vladmandic/human')));
  const destination = new URL('./dist/face-detector/', import.meta.url);
  await mkdir(destination, { recursive: true });
  for (const [path, name] of [
    ['dist/human.js', 'human.js'], ['models/blazeface.json', 'blazeface.json'],
    ['models/blazeface.bin', 'blazeface.bin'], ['LICENSE', 'LICENSE.txt'],
  ]) {
    await copyFile(new URL(path, source), new URL(name, destination));
  }
}
