import { createDatabase, type Database } from '../src/runtime/database.ts';

declare global {
  var __engineeringCompilerDatabase: Database | undefined;
}

export function getDatabase(): Database {
  if (!globalThis.__engineeringCompilerDatabase) {
    globalThis.__engineeringCompilerDatabase = createDatabase();
  }
  return globalThis.__engineeringCompilerDatabase;
}

export function resetDatabase(): void {
  globalThis.__engineeringCompilerDatabase = createDatabase();
}
