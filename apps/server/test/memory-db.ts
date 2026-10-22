import { openDatabase, type Database } from '../src/db/database.js';

/**
 * Fresh in-memory database for a test.
 * Tests must never open the real data/sleepy-coder.db.
 */
export function memoryDb(): Database {
  return openDatabase(':memory:');
}
