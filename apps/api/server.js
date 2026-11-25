import { buildApp } from './app.js';

try {
  const address = await buildApp().listen({ host: '127.0.0.1', port: 3000 });
  console.info(`API disponible sur ${address}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
