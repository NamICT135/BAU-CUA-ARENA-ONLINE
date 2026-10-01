import { pathToFileURL } from 'node:url';
import { createGameServer } from './app.js';
import { createProductionGameServer } from './production.js';

export { createGameServer } from './app.js';
export { createPersistentGameServer } from './persistent.js';
export { createProductionGameServer } from './production.js';

// Importing the server in a test does not bind a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PostgreSQL + cookie authentication is the default application mode. The
  // explicit RAM-only flag remains useful for isolated UI demos and legacy
  // tests, but it is never selected silently when database setup fails.
  const app = process.env.PERSISTENCE_ENABLED === 'false'
    ? await createGameServer()
    : await createProductionGameServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`Bau Cua Arena is running at http://localhost:${port}`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
