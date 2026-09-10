import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = 3000;

// Resolve the configuration relative to this file, then load it once at startup.
const configText = await readFile(new URL('./game-config.json', import.meta.url), 'utf8');
const config = JSON.parse(configText);

const gameState = {
  balance: config.initialBalance,
  history: [],
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/config') {
    sendJson(res, 200, config);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/state') {
    sendJson(res, 200, gameState);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Bau Cua Arena server is running at http://localhost:${port}`);
});
