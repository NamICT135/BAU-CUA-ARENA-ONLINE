import { createGameServer } from './app.js';
import { GamePersistenceService } from './services/GamePersistenceService.js';

export async function createPersistentGameServer(options = {}) {
  const requiredAdapters = ['authenticateSocket', 'authorizeSocketCommand', 'authenticateHttp'];
  const missingAdapters = requiredAdapters.filter(name => typeof options[name] !== 'function');
  if (missingAdapters.length > 0) {
    throw new TypeError(
      `Persistent mode requires authentication adapters: ${missingAdapters.join(', ')}.`
    );
  }
  const persistence = options.persistence ?? new GamePersistenceService();
  return createGameServer({ ...options, persistence });
}
