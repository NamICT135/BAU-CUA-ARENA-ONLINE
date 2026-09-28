import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../../../server/app.js';

// Exercise the actual built app without interrupting an existing game server.
const app = await createGameServer({ distDir: fileURLToPath(new URL('../../../dist/', import.meta.url)) });
try {
  await app.listen(0, '127.0.0.1');
  const address = app.httpServer.address();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./verify-lobby.cjs', import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, DRAGON_LOBBY_URL: `http://127.0.0.1:${address.port}/` },
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Production browser verification exited with ${code}`);
} finally {
  await app.close();
}
