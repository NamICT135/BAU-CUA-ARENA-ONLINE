import { createGameServer } from './app.js';
import { GamePersistenceService } from '../src/services/GamePersistenceService.js';

export async function createPersistentGameServer(options = {}) {
  if (typeof options.authenticateSocket !== 'function') {
    throw new TypeError('Persistent mode requires authenticateSocket(socket) from the login module.');
  }
  const persistence = options.persistence ?? new GamePersistenceService();
  return createGameServer({ ...options, persistence });
}
