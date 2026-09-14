import { pathToFileURL } from 'node:url';
import { createGameServer } from './server/app.js';

export { createGameServer } from './server/app.js';

// Importing the server in a test does not bind a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createGameServer();
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
