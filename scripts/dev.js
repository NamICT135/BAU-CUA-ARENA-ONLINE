import { createServer as createViteServer } from 'vite';
import { createGameServer } from '../server/app.js';
import { createProductionGameServer } from '../server/production.js';

function option(name) {
  const direct = process.argv.indexOf(name);
  if (direct >= 0) return process.argv[direct + 1];
  const inline = process.argv.find(value => value.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

const apiPort = Number(process.env.API_PORT || 3000);
const requestedPort = option('--port');
const requestedHost = option('--host');
const vitePort = requestedPort === undefined ? undefined : Number(requestedPort);
if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('API_PORT must be a valid port.');
if (vitePort !== undefined && (!Number.isSafeInteger(vitePort) || vitePort < 1 || vitePort > 65535)) throw new Error('--port must be a valid port.');

// Use the same authenticated PostgreSQL application as `npm start`.
// The legacy RAM server has no account or Admin HTTP routes.
const game = process.env.PERSISTENCE_ENABLED === 'false'
  ? await createGameServer()
  : await createProductionGameServer();
let vite;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  await vite?.close();
  await game.close();
}

try {
  await game.listen(apiPort, '127.0.0.1');
  vite = await createViteServer({
    server: {
      ...(vitePort === undefined ? {} : { port: vitePort }),
      ...(requestedHost === undefined ? {} : { host: requestedHost }),
    },
  });
  await vite.listen();
  console.log(`Máy chủ phòng: http://127.0.0.1:${apiPort}`);
  vite.printUrls();
} catch (error) {
  await close();
  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await close();
    process.exit(0);
  });
}
