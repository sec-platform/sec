import { createRuntimeStore, getRuntimeDatabase, type Database, type RuntimeStore } from '../src/runtime/database.ts';

declare global {
  var __engineeringCompilerRuntimeStore: RuntimeStore | undefined;
}

export function getRuntimeStore(): RuntimeStore {
  if (!globalThis.__engineeringCompilerRuntimeStore) {
    globalThis.__engineeringCompilerRuntimeStore = createRuntimeStore('postgres-contract');
  }
  return globalThis.__engineeringCompilerRuntimeStore;
}

export function getDatabase(): Database {
  return getRuntimeDatabase(getRuntimeStore());
}

export function resetDatabase(): void {
  globalThis.__engineeringCompilerRuntimeStore = createRuntimeStore('postgres-contract');
}
